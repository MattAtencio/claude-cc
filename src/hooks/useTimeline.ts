import { useEffect, useRef, useCallback, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  SessionTimeline,
  Wave,
  Activity,
  ToolCall,
  TokenUsage,
} from "../types/timeline";

// --- Pattern detection ---

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

const APPROVAL_PATTERNS = [
  /Allow/,
  /\(Y\/n\)/,
  /\(y\/N\)/,
  /Do you want to/,
  /Allow access/,
  /\? \[y\/n\]/i,
  /permission/i,
];

const COMMIT_PATTERN = /\[main [a-f0-9]+\]|\[master [a-f0-9]+\]/;
const TEST_PASS_PATTERN = /tests? passed|✓ \d+ test|test result: ok/i;
const TEST_FAIL_PATTERN = /tests? failed|✗|FAIL|test result: FAILED/i;
const DEPLOY_PATTERN = /git push|pushed to|To https:\/\/github/;
const COST_PATTERN = /est~\s*\$([0-9.]+)/;
const TOKEN_PATTERN = /(\d[\d,]*)in\/([0-9.]+[kKmM]?)out/;

// Infer activity type from tool sequence
const READ_TOOLS = new Set(["Read", "Grep", "Glob", "WebSearch", "WebFetch"]);
const WRITE_TOOLS = new Set(["Edit", "Write"]);
const EXEC_TOOLS = new Set(["Bash"]);

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

function parseTokenString(s: string): number {
  if (!s) return 0;
  const clean = s.replace(/,/g, "");
  const m = clean.match(/^([0-9.]+)([kKmM]?)$/);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  if (m[2] === "k" || m[2] === "K") return Math.round(num * 1000);
  if (m[2] === "m" || m[2] === "M") return Math.round(num * 1000000);
  return Math.round(num);
}

function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return { input: a.input + b.input, output: a.output + b.output };
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return `${n}`;
}

export { formatTokens };

let idCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}-${++idCounter}`;
}

// --- Activity inference ---
// Groups consecutive tool calls into human-readable activities

function inferActivityType(tools: string[]): Activity["type"] {
  if (tools.length === 0) return "research";
  const lastFew = tools.slice(-3);
  const hasWrites = lastFew.some((t) => WRITE_TOOLS.has(t));
  const hasExec = lastFew.some((t) => EXEC_TOOLS.has(t));
  const allReads = lastFew.every((t) => READ_TOOLS.has(t));

  if (allReads) return "research";
  if (hasExec && !hasWrites) return "testing";
  if (hasWrites) return "implementation";
  return "research";
}

function inferActivityLabel(type: Activity["type"], toolCalls: ToolCall[]): string {
  const details = toolCalls
    .map((t) => t.detail)
    .filter(Boolean)
    .slice(-3);

  switch (type) {
    case "research": {
      // Try to extract file/pattern names from read calls
      const targets = toolCalls
        .filter((t) => READ_TOOLS.has(t.tool))
        .map((t) => {
          const m = t.detail.match(/[A-Za-z][\w.-]*\.\w+/);
          return m ? m[0] : null;
        })
        .filter(Boolean)
        .slice(0, 3);
      return targets.length > 0
        ? `Researching ${targets.join(", ")}`
        : "Researching codebase";
    }
    case "implementation": {
      const files = toolCalls
        .filter((t) => WRITE_TOOLS.has(t.tool))
        .map((t) => {
          const m = t.detail.match(/[A-Za-z][\w.-]*\.\w+/);
          return m ? m[0] : null;
        })
        .filter(Boolean)
        .slice(0, 3);
      return files.length > 0
        ? `Editing ${files.join(", ")}`
        : "Implementing changes";
    }
    case "testing": {
      const cmds = toolCalls
        .filter((t) => t.tool === "Bash")
        .map((t) => {
          const m = t.detail.match(/Bash\((.{0,40})/);
          return m ? m[1] : null;
        })
        .filter(Boolean)
        .slice(0, 2);
      return cmds.length > 0
        ? `Running ${cmds.join(", ")}`
        : "Running commands";
    }
    default:
      return details[0] || "Working";
  }
}

// --- Main hook ---

const ACTIVITY_TOOL_THRESHOLD = 4; // Group tools into activity after this many
const WAVE_COMMIT_THRESHOLD = 8; // New wave after commit with 8+ tools in current wave

export function useTimeline(projectId: string | null, hasActiveSession: boolean) {
  const [timeline, setTimeline] = useState<SessionTimeline | null>(null);
  const tlRef = useRef<SessionTimeline | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const stateUnlistenRef = useRef<UnlistenFn | null>(null);

  // Token tracking
  const prevTokensRef = useRef<TokenUsage>({ input: 0, output: 0 });
  const lastToolTimeRef = useRef<number>(0);
  const lastApprovalTimeRef = useRef<number>(0);
  const pendingToolsRef = useRef<ToolCall[]>([]);

  const flush = useCallback(() => {
    setTimeline(tlRef.current ? { ...tlRef.current } : null);
  }, []);

  // Get or create the current wave and current activity
  const currentWave = useCallback((): Wave => {
    const tl = tlRef.current!;
    return tl.waves[tl.waves.length - 1];
  }, []);

  const currentActivity = useCallback((): Activity | null => {
    const wave = currentWave();
    return wave.activities.length > 0
      ? wave.activities[wave.activities.length - 1]
      : null;
  }, [currentWave]);

  // Finalize the current activity (set status, compute label)
  const finalizeActivity = useCallback(() => {
    const act = currentActivity();
    if (act && act.status === "active") {
      act.status = "completed";
      act.endedAt = Date.now();
      // Re-infer label based on final tool set
      act.label = inferActivityLabel(
        act.type,
        act.toolCalls,
      );
    }
  }, [currentActivity]);

  // Start a new activity
  const startActivity = useCallback(
    (type: Activity["type"], label: string): Activity => {
      finalizeActivity();
      const act: Activity = {
        id: nextId("act"),
        type,
        label,
        startedAt: Date.now(),
        status: "active",
        toolCalls: [],
        tokens: { input: 0, output: 0 },
      };
      currentWave().activities.push(act);
      return act;
    },
    [currentWave, finalizeActivity],
  );

  // Start a new wave
  const startWave = useCallback(
    (name: string) => {
      const tl = tlRef.current!;
      // Finalize current wave
      const cw = currentWave();
      finalizeActivity();
      cw.status = "completed";
      cw.endedAt = Date.now();

      tl.waves.push({
        id: nextId("wave"),
        name,
        startedAt: Date.now(),
        status: "active",
        activities: [],
        tokens: { input: 0, output: 0 },
      });
    },
    [currentWave, finalizeActivity],
  );

  // Add a tool call to the current activity, creating/splitting activities as needed
  const addToolCall = useCallback(
    (tool: string, detail: string, deltaTokens: TokenUsage) => {
      const tl = tlRef.current!;
      let act = currentActivity();

      // Determine if we should start a new activity
      const recentTools = act
        ? act.toolCalls.map((t) => t.tool)
        : [];
      const prevType = act?.type;
      const newType = inferActivityType([...recentTools, tool]);

      // Start new activity if: no current, or type changed after threshold
      if (
        !act ||
        act.status !== "active" ||
        (prevType !== newType && act.toolCalls.length >= ACTIVITY_TOOL_THRESHOLD)
      ) {
        act = startActivity(newType, "Working...");
      }

      const tc: ToolCall = {
        id: nextId("tc"),
        tool,
        detail,
        timestamp: Date.now(),
        tokens: { ...deltaTokens },
      };

      act.toolCalls.push(tc);
      act.tokens = addTokens(act.tokens, deltaTokens);
      act.label = inferActivityLabel(act.type, act.toolCalls);

      // Bubble up tokens
      const wave = currentWave();
      wave.tokens = addTokens(wave.tokens, deltaTokens);
      tl.totalTokens = addTokens(tl.totalTokens, deltaTokens);
      tl.totalToolCalls++;

      // Cap tool calls per activity
      if (act.toolCalls.length > 100) {
        act.toolCalls = act.toolCalls.slice(-80);
      }

      flush();
    },
    [currentActivity, currentWave, startActivity, flush],
  );

  const reset = useCallback(() => {
    idCounter = 0;
    prevTokensRef.current = { input: 0, output: 0 };
    lastToolTimeRef.current = 0;
    lastApprovalTimeRef.current = 0;
    pendingToolsRef.current = [];

    const initial: SessionTimeline = {
      startedAt: Date.now(),
      waves: [
        {
          id: nextId("wave"),
          name: "Wave 1",
          startedAt: Date.now(),
          status: "active",
          activities: [],
          tokens: { input: 0, output: 0 },
        },
      ],
      totalTokens: { input: 0, output: 0 },
      estimatedCost: "0.00",
      totalToolCalls: 0,
      totalApprovals: 0,
    };
    tlRef.current = initial;
    setTimeline({ ...initial });
  }, []);

  // --- Event listeners ---

  useEffect(() => {
    if (!projectId || !hasActiveSession) return;
    reset();

    // Listen to PTY output
    listen<string>(`pty-output-${projectId}`, (event) => {
      const tl = tlRef.current;
      if (!tl) return;

      const clean = stripAnsi(event.payload);
      const now = Date.now();

      // --- Parse token delta from status bar ---
      let deltaTokens: TokenUsage = { input: 0, output: 0 };
      const tokenMatch = clean.match(TOKEN_PATTERN);
      if (tokenMatch) {
        const newIn = parseTokenString(tokenMatch[1]);
        const newOut = parseTokenString(tokenMatch[2]);
        if (newIn > 0 || newOut > 0) {
          deltaTokens = {
            input: Math.max(0, newIn - prevTokensRef.current.input),
            output: Math.max(0, newOut - prevTokensRef.current.output),
          };
          // Only update if we got a meaningful increase
          if (deltaTokens.input > 0 || deltaTokens.output > 0) {
            prevTokensRef.current = { input: newIn, output: newOut };
          } else {
            deltaTokens = { input: 0, output: 0 };
          }
        }
      }

      // --- Cost ---
      const costMatch = clean.match(COST_PATTERN);
      if (costMatch) {
        tl.estimatedCost = costMatch[1];
      }

      // --- Tool calls ---
      for (const [tool, pattern] of Object.entries(TOOL_PATTERNS)) {
        if (pattern.test(clean)) {
          if (now - lastToolTimeRef.current < 300) break; // debounce
          lastToolTimeRef.current = now;

          const lines = clean.split("\n").filter((l) => pattern.test(l));
          const detail = lines[0]?.trim().slice(0, 120) || tool;

          addToolCall(tool, detail, deltaTokens);
          break;
        }
      }

      // --- Approvals ---
      if (
        APPROVAL_PATTERNS.some((p) => p.test(clean)) &&
        now - lastApprovalTimeRef.current > 1500
      ) {
        lastApprovalTimeRef.current = now;
        tl.totalApprovals++;

        const approvalLine =
          clean
            .split("\n")
            .find((l) => APPROVAL_PATTERNS.some((p) => p.test(l)))
            ?.trim()
            .slice(0, 100) || "Approval needed";

        // Approvals are their own single-step activity
        finalizeActivity();
        const act: Activity = {
          id: nextId("act"),
          type: "approval",
          label: approvalLine,
          startedAt: now,
          endedAt: now,
          status: "completed",
          toolCalls: [],
          tokens: { input: 0, output: 0 },
        };
        currentWave().activities.push(act);
        flush();
      }

      // --- Commits ---
      if (COMMIT_PATTERN.test(clean)) {
        const commitLine = clean
          .split("\n")
          .find((l) => COMMIT_PATTERN.test(l))
          ?.trim()
          .slice(0, 120);

        finalizeActivity();
        const act: Activity = {
          id: nextId("act"),
          type: "commit",
          label: commitLine || "Committed",
          startedAt: now,
          endedAt: now,
          status: "completed",
          toolCalls: [],
          tokens: { input: 0, output: 0 },
        };
        currentWave().activities.push(act);

        // Wave boundary: commit after significant work
        const wave = currentWave();
        const waveToolCount = wave.activities.reduce(
          (sum, a) => sum + a.toolCalls.length,
          0,
        );
        if (waveToolCount >= WAVE_COMMIT_THRESHOLD) {
          startWave(`Wave ${tl.waves.length + 1}`);
        }

        flush();
      }

      // --- Test results ---
      if (TEST_PASS_PATTERN.test(clean)) {
        const line = clean.split("\n").find((l) => TEST_PASS_PATTERN.test(l))?.trim();
        finalizeActivity();
        currentWave().activities.push({
          id: nextId("act"),
          type: "testing",
          label: `✓ ${line?.slice(0, 80) || "Tests passed"}`,
          startedAt: now,
          endedAt: now,
          status: "completed",
          toolCalls: [],
          tokens: { input: 0, output: 0 },
        });
        flush();
      }
      if (TEST_FAIL_PATTERN.test(clean)) {
        const line = clean.split("\n").find((l) => TEST_FAIL_PATTERN.test(l))?.trim();
        finalizeActivity();
        currentWave().activities.push({
          id: nextId("act"),
          type: "error",
          label: `✗ ${line?.slice(0, 80) || "Tests failed"}`,
          startedAt: now,
          endedAt: now,
          status: "completed",
          toolCalls: [],
          tokens: { input: 0, output: 0 },
        });
        flush();
      }

      // --- Deploy ---
      if (DEPLOY_PATTERN.test(clean)) {
        const line = clean.split("\n").find((l) => DEPLOY_PATTERN.test(l))?.trim();
        finalizeActivity();
        currentWave().activities.push({
          id: nextId("act"),
          type: "deploy",
          label: line?.slice(0, 100) || "Pushed",
          startedAt: now,
          endedAt: now,
          status: "completed",
          toolCalls: [],
          tokens: { input: 0, output: 0 },
        });
        flush();
      }
    }).then((unlisten) => {
      unlistenRef.current = unlisten;
    });

    // State listener — just track current state, no timeline entries
    listen<string>(`session-state-${projectId}`, () => {
      // No-op for timeline — state changes are noise
    }).then((unlisten) => {
      stateUnlistenRef.current = unlisten;
    });

    return () => {
      unlistenRef.current?.();
      stateUnlistenRef.current?.();
      unlistenRef.current = null;
      stateUnlistenRef.current = null;
    };
  }, [projectId, hasActiveSession, reset, addToolCall, flush, finalizeActivity, currentWave, startWave]);

  // Finalize on session end
  useEffect(() => {
    if (!hasActiveSession && tlRef.current) {
      const tl = tlRef.current;
      const wave = tl.waves[tl.waves.length - 1];
      if (wave && wave.status === "active") {
        finalizeActivity();
        wave.status = "completed";
        wave.endedAt = Date.now();
        setTimeline({ ...tl });
      }
    }
  }, [hasActiveSession, finalizeActivity]);

  return { timeline };
}
