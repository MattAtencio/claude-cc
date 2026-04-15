import { useEffect, useRef, useCallback, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { TimelineMetrics, TimelineStep } from "../types/timeline";

// Tool call patterns from Claude CLI output
const TOOL_PATTERNS: Record<string, RegExp> = {
  Read: /Read\(|⚙ Read/,
  Edit: /Edit\(|⚙ Edit/,
  Write: /Write\(|⚙ Write/,
  Bash: /Bash\(|⚙ Bash/,
  Grep: /Grep\(|⚙ Grep/,
  Glob: /Glob\(|⚙ Glob/,
  Agent: /Agent\(|⚙ Agent/,
  WebSearch: /WebSearch\(|⚙ WebSearch/,
  WebFetch: /WebFetch\(|⚙ WebFetch/,
};

// Broad approval detection — anything requiring CTO input
const APPROVAL_PATTERNS = [
  /Allow/,
  /\(Y\/n\)/,
  /\(y\/N\)/,
  /\(n\)/,
  /approve/i,
  /Do you want to/,
  /Allow access/,
  /Press Enter/,
  /\? \[y\/n\]/i,
  /allow.*tool/i,
  /permission/i,
];

const COMMIT_PATTERN = /\[main [a-f0-9]+\]|\[master [a-f0-9]+\]/;
const TEST_PASS_PATTERN = /tests? passed|✓ \d+ test|test result: ok/i;
const TEST_FAIL_PATTERN = /tests? failed|✗|FAIL|test result: FAILED/i;
const DEPLOY_PATTERN = /deployed|pushed to|push.*origin|git push/i;
const ERROR_PATTERN = /error\[E|panic|ERROR:|fatal:/;
const COST_PATTERN = /est~\s*\$([0-9.]+)/;

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

let stepCounter = 0;
function nextStepId(): string {
  return `step-${++stepCounter}`;
}

let phaseCounter = 0;
function nextPhaseId(): string {
  return `phase-${++phaseCounter}`;
}

export function useTimeline(projectId: string | null, hasActiveSession: boolean) {
  const [metrics, setMetrics] = useState<TimelineMetrics | null>(null);
  const metricsRef = useRef<TimelineMetrics | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const stateUnlistenRef = useRef<UnlistenFn | null>(null);
  const lastToolRef = useRef<string>("");
  const lastToolTimeRef = useRef<number>(0);
  const lastApprovalRef = useRef<number>(0);

  const resetTimeline = useCallback(() => {
    stepCounter = 0;
    phaseCounter = 0;
    lastToolRef.current = "";
    lastToolTimeRef.current = 0;
    lastApprovalRef.current = 0;

    const initial: TimelineMetrics = {
      startedAt: Date.now(),
      totalToolCalls: 0,
      toolCallsByType: {},
      totalApprovals: 0,
      stateChanges: 0,
      currentState: "Starting",
      phases: [
        {
          id: nextPhaseId(),
          name: "Wave 1",
          startedAt: Date.now(),
          status: "active",
          steps: [],
          toolCalls: 0,
          approvals: 0,
        },
      ],
    };
    metricsRef.current = initial;
    setMetrics({ ...initial });
  }, []);

  const addStep = useCallback((step: TimelineStep) => {
    const m = metricsRef.current;
    if (!m || m.phases.length === 0) return;

    const currentPhase = m.phases[m.phases.length - 1];
    currentPhase.steps.push(step);

    // Keep last 200 steps per phase
    if (currentPhase.steps.length > 200) {
      currentPhase.steps = currentPhase.steps.slice(-150);
    }

    setMetrics({ ...m });
  }, []);

  const startNewPhase = useCallback((name: string) => {
    const m = metricsRef.current;
    if (!m) return;

    const current = m.phases[m.phases.length - 1];
    if (current) {
      current.status = "completed";
      current.endedAt = Date.now();
    }

    m.phases.push({
      id: nextPhaseId(),
      name,
      startedAt: Date.now(),
      status: "active",
      steps: [],
      toolCalls: 0,
      approvals: 0,
    });

    setMetrics({ ...m });
  }, []);

  useEffect(() => {
    if (!projectId || !hasActiveSession) return;

    resetTimeline();

    // Listen to raw PTY output — parse work events only
    listen<string>(`pty-output-${projectId}`, (event) => {
      const m = metricsRef.current;
      if (!m) return;

      const clean = stripAnsi(event.payload);
      const now = Date.now();
      const currentPhase = m.phases[m.phases.length - 1];
      let changed = false;

      // --- Tool calls ---
      for (const [tool, pattern] of Object.entries(TOOL_PATTERNS)) {
        if (pattern.test(clean)) {
          // Debounce same tool within 500ms
          if (lastToolRef.current === tool && now - lastToolTimeRef.current < 500) {
            break;
          }
          lastToolRef.current = tool;
          lastToolTimeRef.current = now;

          m.totalToolCalls++;
          m.toolCallsByType[tool] = (m.toolCallsByType[tool] || 0) + 1;
          if (currentPhase) currentPhase.toolCalls++;

          const lines = clean.split("\n").filter((l) => pattern.test(l));
          const detail = lines[0]?.trim().slice(0, 100);

          addStep({
            id: nextStepId(),
            type: "tool-call",
            name: tool,
            detail,
            timestamp: now,
          });
          changed = true;
          break;
        }
      }

      // --- Approvals (any CTO input required) ---
      if (APPROVAL_PATTERNS.some((p) => p.test(clean)) && now - lastApprovalRef.current > 1500) {
        lastApprovalRef.current = now;
        m.totalApprovals++;
        if (currentPhase) currentPhase.approvals++;

        const approvalLine = clean.split("\n").find((l) =>
          APPROVAL_PATTERNS.some((p) => p.test(l))
        )?.trim().slice(0, 100);

        addStep({
          id: nextStepId(),
          type: "approval",
          name: "Approval needed",
          detail: approvalLine,
          timestamp: now,
        });
        changed = true;
      }

      // --- Commits ---
      if (COMMIT_PATTERN.test(clean)) {
        const commitLine = clean.split("\n").find((l) => COMMIT_PATTERN.test(l))?.trim();
        addStep({
          id: nextStepId(),
          type: "commit",
          name: "Commit",
          detail: commitLine?.slice(0, 100),
          timestamp: now,
        });
        changed = true;
      }

      // --- Test results ---
      if (TEST_PASS_PATTERN.test(clean)) {
        const line = clean.split("\n").find((l) => TEST_PASS_PATTERN.test(l))?.trim();
        addStep({
          id: nextStepId(),
          type: "test-pass",
          name: "Tests passed",
          detail: line?.slice(0, 100),
          timestamp: now,
        });
        changed = true;
      }
      if (TEST_FAIL_PATTERN.test(clean)) {
        const line = clean.split("\n").find((l) => TEST_FAIL_PATTERN.test(l))?.trim();
        addStep({
          id: nextStepId(),
          type: "test-fail",
          name: "Tests failed",
          detail: line?.slice(0, 100),
          timestamp: now,
        });
        changed = true;
      }

      // --- Deploys / pushes ---
      if (DEPLOY_PATTERN.test(clean)) {
        const line = clean.split("\n").find((l) => DEPLOY_PATTERN.test(l))?.trim();
        addStep({
          id: nextStepId(),
          type: "deploy",
          name: "Push/Deploy",
          detail: line?.slice(0, 100),
          timestamp: now,
        });
        changed = true;
      }

      // --- Errors ---
      if (ERROR_PATTERN.test(clean)) {
        const line = clean.split("\n").find((l) => ERROR_PATTERN.test(l))?.trim();
        addStep({
          id: nextStepId(),
          type: "error",
          name: "Error",
          detail: line?.slice(0, 100),
          timestamp: now,
        });
        changed = true;
      }

      // --- Token/cost tracking ---
      const costMatch = clean.match(COST_PATTERN);
      if (costMatch) {
        m.estimatedCost = costMatch[1];
      }

      // --- New wave detection: commit after significant work suggests a wave boundary ---
      if (
        COMMIT_PATTERN.test(clean) &&
        currentPhase &&
        currentPhase.toolCalls > 10
      ) {
        startNewPhase(`Wave ${m.phases.length + 1}`);
      }

      if (changed) {
        setMetrics({ ...m });
      }
    }).then((unlisten) => {
      unlistenRef.current = unlisten;
    });

    // Listen to state changes — only track current state, don't add timeline steps
    listen<string>(`session-state-${projectId}`, (event) => {
      const m = metricsRef.current;
      if (!m) return;
      m.stateChanges++;
      m.currentState = event.payload;
      setMetrics({ ...m });
    }).then((unlisten) => {
      stateUnlistenRef.current = unlisten;
    });

    return () => {
      unlistenRef.current?.();
      stateUnlistenRef.current?.();
      unlistenRef.current = null;
      stateUnlistenRef.current = null;
    };
  }, [projectId, hasActiveSession, resetTimeline, addStep, startNewPhase]);

  useEffect(() => {
    if (!hasActiveSession && metricsRef.current) {
      const m = metricsRef.current;
      const current = m.phases[m.phases.length - 1];
      if (current && current.status === "active") {
        current.status = "completed";
        current.endedAt = Date.now();
        setMetrics({ ...m });
      }
    }
  }, [hasActiveSession]);

  return { metrics };
}
