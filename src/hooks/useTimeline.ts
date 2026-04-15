import { useEffect, useRef, useCallback, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { TimelineMetrics, TimelineStep } from "../types/timeline";

// Patterns to detect from PTY output (ANSI-stripped by looking at visible text)
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

const APPROVAL_PATTERN = /Allow|approve|\(Y\/n\)|\(y\/N\)/;
const COMMIT_PATTERN = /git commit|Creating commit|\[main [a-f0-9]+\]/;
const THINKING_PATTERN = /Thinking|Transfiguring/;

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
  const lastApprovalRef = useRef<number>(0);

  const resetTimeline = useCallback(() => {
    stepCounter = 0;
    phaseCounter = 0;
    lastToolRef.current = "";
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
          name: "Session Start",
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

    // Keep last 200 steps per phase to avoid unbounded growth
    if (currentPhase.steps.length > 200) {
      currentPhase.steps = currentPhase.steps.slice(-150);
    }

    setMetrics({ ...m });
  }, []);

  const startNewPhase = useCallback((name: string) => {
    const m = metricsRef.current;
    if (!m) return;

    // Close current phase
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

  // Listen to PTY output and parse events
  useEffect(() => {
    if (!projectId || !hasActiveSession) return;

    resetTimeline();

    // Listen to raw PTY output for tool/approval detection
    listen<string>(`pty-output-${projectId}`, (event) => {
      const m = metricsRef.current;
      if (!m) return;

      const clean = stripAnsi(event.payload);
      const now = Date.now();
      const currentPhase = m.phases[m.phases.length - 1];

      // Detect tool calls
      for (const [tool, pattern] of Object.entries(TOOL_PATTERNS)) {
        if (pattern.test(clean)) {
          // Debounce: don't double-count same tool within 500ms
          const lastStep = currentPhase?.steps[currentPhase.steps.length - 1];
          if (lastToolRef.current === tool && now - (lastStep?.timestamp ?? 0) < 500) {
            continue;
          }
          lastToolRef.current = tool;

          m.totalToolCalls++;
          m.toolCallsByType[tool] = (m.toolCallsByType[tool] || 0) + 1;
          if (currentPhase) currentPhase.toolCalls++;

          // Extract a brief detail from the line
          const lines = clean.split("\n").filter((l) => pattern.test(l));
          const detail = lines[0]?.trim().slice(0, 80);

          addStep({
            id: nextStepId(),
            type: "tool-call",
            name: tool,
            detail,
            timestamp: now,
          });
          break; // Only match first tool per output chunk
        }
      }

      // Detect approvals
      if (APPROVAL_PATTERN.test(clean) && now - lastApprovalRef.current > 2000) {
        lastApprovalRef.current = now;
        m.totalApprovals++;
        if (currentPhase) currentPhase.approvals++;

        addStep({
          id: nextStepId(),
          type: "approval",
          name: "Permission prompt",
          detail: clean.split("\n").find((l) => APPROVAL_PATTERN.test(l))?.trim().slice(0, 80),
          timestamp: now,
        });
      }

      // Detect commits
      if (COMMIT_PATTERN.test(clean)) {
        const commitLine = clean.split("\n").find((l) => COMMIT_PATTERN.test(l))?.trim();
        addStep({
          id: nextStepId(),
          type: "commit",
          name: "Commit",
          detail: commitLine?.slice(0, 80),
          timestamp: now,
        });
      }

      // Detect thinking (start new phase)
      if (THINKING_PATTERN.test(clean) && currentPhase && currentPhase.steps.length > 5) {
        startNewPhase(`Wave ${m.phases.length}`);
      }

      setMetrics({ ...m });
    }).then((unlisten) => {
      unlistenRef.current = unlisten;
    });

    // Listen to state changes
    listen<string>(`session-state-${projectId}`, (event) => {
      const m = metricsRef.current;
      if (!m) return;

      m.stateChanges++;
      m.currentState = event.payload;

      addStep({
        id: nextStepId(),
        type: "state-change",
        name: event.payload,
        timestamp: Date.now(),
      });
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

  // Clear timeline when session ends
  useEffect(() => {
    if (!hasActiveSession && metricsRef.current) {
      // Close final phase
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
