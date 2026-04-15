import { useEffect, useRef, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { SessionStatus } from "../types";
import "@xterm/xterm/css/xterm.css";

const THEME = {
  background: "#0a0a0a",
  foreground: "#e5e5e5",
  cursor: "#a855f7",
  selectionBackground: "#a855f733",
  black: "#1a1a2e",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#e5e5e5",
  brightBlack: "#4a4a5a",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde68a",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#ffffff",
};

interface TermInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  unlisten: UnlistenFn | null;
  onDataDispose: { dispose: () => void };
  onResizeDispose: { dispose: () => void };
}

// Track activity state per session for status dots
// "working" = Claude outputting, "waiting" = idle, "blocked" = permission prompt
export type SessionActivity = "working" | "waiting" | "blocked";
type ActivityMap = Record<string, SessionActivity>;

interface TerminalProps {
  projectId: string | null;
  projectName?: string;
  projectColor?: string;
  sessions: SessionStatus[];
  onSessionChange: () => void;
  onActivityChange?: (activity: ActivityMap) => void;
}

export function TerminalView({
  projectId,
  projectName,
  projectColor,
  sessions,
  onSessionChange,
  onActivityChange,
}: TerminalProps) {
  const instancesRef = useRef<Map<string, TermInstance>>(new Map());
  const containersRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [promptInput, setPromptInput] = useState("");
  const [, setTick] = useState(0);

  // Activity tracking: last output time per session
  const lastOutputRef = useRef<Map<string, number>>(new Map());
  const activityRef = useRef<ActivityMap>({});
  const activityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sessionSet = new Set(sessions.map((s) => s.projectId));
  const hasActiveSession = projectId ? sessionSet.has(projectId) : false;

  // Activity monitor — check every 1s if sessions went idle
  useEffect(() => {
    activityTimerRef.current = setInterval(() => {
      const now = Date.now();
      let changed = false;
      const newActivity: ActivityMap = {};

      for (const [pid, lastTime] of lastOutputRef.current) {
        const prev = activityRef.current[pid];
        // If no output for 2+ seconds, session is waiting for user
        const current: SessionActivity =
          now - lastTime > 2000 ? "waiting" : "working";
        newActivity[pid] = current;
        if (prev !== current) changed = true;
      }

      if (changed) {
        activityRef.current = newActivity;
        onActivityChange?.(newActivity);
      }
    }, 1000);

    return () => {
      if (activityTimerRef.current) clearInterval(activityTimerRef.current);
    };
  }, [onActivityChange]);

  // Create terminal and immediately show it
  const attachTerminal = useCallback(
    async (pid: string, showImmediately: boolean) => {
      if (instancesRef.current.has(pid)) {
        // Already exists — just show it if needed
        const container = containersRef.current.get(pid);
        if (container && showImmediately) {
          container.style.display = "block";
          const inst = instancesRef.current.get(pid);
          if (inst) {
            setTimeout(() => {
              try {
                inst.fitAddon.fit();
                inst.terminal.focus();
              } catch {}
            }, 50);
          }
        }
        return;
      }
      if (!wrapperRef.current) return;

      const container = document.createElement("div");
      container.className = "xterm-container";
      // Show immediately if this is for the focused project
      container.style.display = showImmediately ? "block" : "none";
      container.dataset.projectId = pid;
      wrapperRef.current.appendChild(container);
      containersRef.current.set(pid, container);

      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
        theme: THEME,
        allowProposedApi: true,
        scrollback: 10000,
        windowsPty: {
          backend: "conpty",
          buildNumber: 19041,
        },
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon());

      terminal.open(container);

      // Fit with aggressive retries — PTY MUST know real dimensions
      // Each fit() triggers onResize which sends resize_session to PTY backend
      const doFit = () => {
        try {
          fitAddon.fit();
        } catch {}
      };

      // Immediate fit
      doFit();
      // Retries as layout settles (flex reflow, container dimensions stabilize)
      for (const delay of [50, 150, 300, 600, 1000]) {
        setTimeout(doFit, delay);
      }

      if (showImmediately) {
        setTimeout(() => terminal.focus(), 100);
      }

      // Track output timestamps for activity detection
      lastOutputRef.current.set(pid, Date.now());

      const onDataDispose = terminal.onData((data: string) => {
        invoke("write_to_session", { projectId: pid, data }).catch(() => {});
      });

      const onResizeDispose = terminal.onResize(({ cols, rows }) => {
        invoke("resize_session", { projectId: pid, rows, cols }).catch(
          () => {},
        );
      });

      const unlisten = await listen<string>(`pty-output-${pid}`, (event) => {
        terminal.write(event.payload);
        // Mark this session as having recent output
        lastOutputRef.current.set(pid, Date.now());
      });

      instancesRef.current.set(pid, {
        terminal,
        fitAddon,
        unlisten,
        onDataDispose,
        onResizeDispose,
      });
    },
    [],
  );

  const destroyTerminal = useCallback((pid: string) => {
    const instance = instancesRef.current.get(pid);
    if (instance) {
      instance.unlisten?.();
      instance.onDataDispose.dispose();
      instance.onResizeDispose.dispose();
      instance.terminal.dispose();
      instancesRef.current.delete(pid);
    }
    const container = containersRef.current.get(pid);
    if (container) {
      container.remove();
      containersRef.current.delete(pid);
    }
    lastOutputRef.current.delete(pid);
    delete activityRef.current[pid];
  }, []);

  // Show/hide terminals based on focused project
  useEffect(() => {
    for (const [pid, container] of containersRef.current) {
      if (pid === projectId && hasActiveSession) {
        container.style.display = "block";
        const instance = instancesRef.current.get(pid);
        if (instance) {
          // Multiple fit retries — container dimensions may not be stable immediately
          for (const delay of [0, 50, 150, 400]) {
            setTimeout(() => {
              try {
                instance.fitAddon.fit();
                if (delay === 50) instance.terminal.focus();
              } catch {}
            }, delay);
          }
        }
      } else {
        container.style.display = "none";
      }
    }
  }, [projectId, hasActiveSession]);

  // Handle container resize — fit ALL visible terminals
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const observer = new ResizeObserver(() => {
      // Fit whichever terminal is currently visible
      for (const [pid, container] of containersRef.current) {
        if (container.style.display !== "none") {
          const instance = instancesRef.current.get(pid);
          if (instance) {
            try {
              instance.fitAddon.fit();
            } catch {}
          }
        }
      }
    });

    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  // Cleanup all on unmount
  useEffect(() => {
    return () => {
      for (const [, inst] of instancesRef.current) {
        inst.unlisten?.();
        inst.onDataDispose.dispose();
        inst.onResizeDispose.dispose();
        inst.terminal.dispose();
      }
      instancesRef.current.clear();
      containersRef.current.clear();
    };
  }, []);

  // Measure the wrapper to calculate initial PTY dimensions
  function measureTerminalSize(): { rows: number; cols: number } {
    const wrapper = wrapperRef.current;
    if (!wrapper) return { rows: 24, cols: 80 };

    // Use xterm's cell size calculation: fontSize 13 with monospace font
    // Approximate: char width ~7.8px, line height ~17px at 13px font
    const charWidth = 7.8;
    const lineHeight = 17;
    const cols = Math.max(40, Math.floor(wrapper.clientWidth / charWidth) - 1);
    const rows = Math.max(10, Math.floor(wrapper.clientHeight / lineHeight) - 1);
    return { rows, cols };
  }

  async function handleStartSession(initialPrompt?: string) {
    if (!projectId || sessionLoading) return;
    setSessionLoading(true);
    try {
      // Measure container BEFORE creating session so PTY starts at correct size
      const { rows, cols } = measureTerminalSize();

      await invoke("create_session", {
        projectId,
        initialPrompt: initialPrompt || null,
        rows,
        cols,
      });
      onSessionChange();
      // Attach terminal and show it immediately — don't wait for poll
      await attachTerminal(projectId, true);
      setTick((t) => t + 1);
    } catch (err) {
      console.error("Failed to create session:", err);
    } finally {
      setSessionLoading(false);
    }
  }

  async function handleStopSession() {
    if (!projectId) return;
    try {
      destroyTerminal(projectId);
      await invoke("close_session", { projectId });
      onSessionChange();
      setTick((t) => t + 1);
    } catch (err) {
      console.error("Failed to close session:", err);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header bar */}
      <div className="h-10 flex items-center px-4 border-b border-gray-800/50 bg-[#0d0d0d] shrink-0">
        <div className="flex items-center gap-2 flex-1">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: projectColor ?? "#666" }}
          />
          <span className="text-sm font-medium text-gray-300">
            {projectName ?? "No project"}
          </span>
          {hasActiveSession && (
            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-green-900/40 text-green-400">
              active
            </span>
          )}
        </div>
        {projectId && (
          <div className="flex items-center gap-2">
            {hasActiveSession ? (
              <button
                onClick={handleStopSession}
                className="text-[10px] px-2 py-1 rounded bg-red-900/30 text-red-400 hover:bg-red-900/50 transition-colors"
              >
                Stop Session
              </button>
            ) : (
              <button
                onClick={() => handleStartSession()}
                disabled={sessionLoading}
                className="text-[10px] px-2 py-1 rounded bg-green-900/30 text-green-400 hover:bg-green-900/50 transition-colors disabled:opacity-50"
              >
                {sessionLoading ? "Starting..." : "Start Session"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Terminal wrapper — all terminal divs live here */}
      <div ref={wrapperRef} className="flex-1 min-h-0 bg-[#0a0a0a] relative overflow-hidden">
        {!hasActiveSession && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-[#0a0a0a]">
            <div className="w-full max-w-lg px-8">
              {projectId ? (
                <div className="space-y-4">
                  <div className="text-gray-500 text-sm text-center">
                    No active session for {projectName}
                  </div>

                  {/* Prompt input */}
                  <textarea
                    value={promptInput}
                    onChange={(e) => setPromptInput(e.target.value)}
                    placeholder="Optional: Enter a spec or prompt to kick off autonomous work..."
                    className="w-full h-28 bg-[#111] border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 placeholder-gray-700 resize-none focus:outline-none focus:border-purple-500/50 font-mono"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        handleStartSession(promptInput.trim() || undefined);
                      }
                    }}
                  />

                  <div className="flex items-center gap-3 justify-center">
                    <button
                      onClick={() => handleStartSession(promptInput.trim() || undefined)}
                      disabled={sessionLoading}
                      className="px-4 py-2 rounded bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 transition-colors text-sm disabled:opacity-50 font-medium"
                    >
                      {sessionLoading
                        ? "Starting..."
                        : promptInput.trim()
                          ? "Start with Spec"
                          : "Start Session"}
                    </button>
                    <span className="text-[10px] text-gray-600">Ctrl+Enter</span>
                  </div>
                </div>
              ) : (
                <div className="text-gray-600 text-sm font-mono text-center">
                  Select a project from the sidebar
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
