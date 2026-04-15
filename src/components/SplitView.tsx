import { useEffect, useRef, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTerminalManager } from "../hooks/useTerminal";
import { useSplitResize } from "../hooks/useSplitResize";
import type { ProjectConfig, SessionStatus } from "../types";
import type { SessionActivity } from "./Terminal";
import "@xterm/xterm/css/xterm.css";

interface SplitViewProps {
  leftProjectId: string | null;
  rightProjectId: string | null;
  projects: ProjectConfig[];
  sessions: SessionStatus[];
  onSessionChange: () => void;
  onActivityChange?: (activity: Record<string, SessionActivity>) => void;
}

/** A single terminal pane with its own header and terminal container. */
function SplitPane({
  projectId,
  projects,
  sessions,
  terminalManager,
  onSessionChange,
  onSelectProject,
}: {
  projectId: string | null;
  projects: ProjectConfig[];
  sessions: SessionStatus[];
  terminalManager: ReturnType<typeof useTerminalManager>;
  onSessionChange: () => void;
  onSelectProject: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);

  const project = projects.find((p) => p.id === projectId);
  const sessionSet = new Set(sessions.map((s) => s.projectId));
  const hasSession = projectId ? sessionSet.has(projectId) : false;

  // Attach terminal when we have a session
  useEffect(() => {
    if (!projectId || !hasSession || !containerRef.current) return;
    terminalManager.createInstance(projectId, containerRef.current);
  }, [projectId, hasSession, terminalManager]);

  // Fit on container resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !projectId) return;

    const observer = new ResizeObserver(() => {
      terminalManager.fitInstance(projectId);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [projectId, terminalManager]);

  async function handleStart() {
    if (!projectId || loading) return;
    setLoading(true);
    try {
      await invoke("create_session", { projectId });
      onSessionChange();
    } catch (err) {
      console.error("Failed to create session:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleStop() {
    if (!projectId) return;
    try {
      terminalManager.destroyInstance(projectId);
      await invoke("close_session", { projectId });
      onSessionChange();
    } catch (err) {
      console.error("Failed to close session:", err);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {/* Pane header */}
      <div className="h-8 bg-[#0d0d0d] border-b border-gray-800/50 flex items-center px-3 shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: project?.color ?? "#666" }}
          />
          <span className="text-xs font-medium text-gray-300 truncate">
            {project?.name ?? "No project"}
          </span>
          {hasSession && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-green-900/40 text-green-400 shrink-0">
              active
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Project selector */}
          <div className="relative">
            <button
              onClick={() => setSelectorOpen(!selectorOpen)}
              className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 hover:bg-white/10 transition-colors"
            >
              Switch
            </button>
            {selectorOpen && (
              <div className="absolute right-0 top-6 z-50 w-48 max-h-64 overflow-y-auto bg-[#1a1a1a] border border-gray-700 rounded shadow-xl">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      onSelectProject(p.id);
                      setSelectorOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors flex items-center gap-2 ${
                      p.id === projectId
                        ? "text-purple-400"
                        : "text-gray-300"
                    }`}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: p.color ?? "#666" }}
                    />
                    <span className="truncate">{p.name}</span>
                    {sessionSet.has(p.id) && (
                      <span className="ml-auto text-[8px] text-green-500">
                        live
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Start/Stop */}
          {projectId &&
            (hasSession ? (
              <button
                onClick={handleStop}
                className="text-[9px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-400 hover:bg-red-900/50 transition-colors"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={handleStart}
                disabled={loading}
                className="text-[9px] px-1.5 py-0.5 rounded bg-green-900/30 text-green-400 hover:bg-green-900/50 transition-colors disabled:opacity-50"
              >
                {loading ? "..." : "Start"}
              </button>
            ))}
        </div>
      </div>

      {/* Terminal container */}
      <div className="flex-1 min-h-0 bg-[#0a0a0a] relative">
        <div ref={containerRef} className="absolute inset-0" />
        {!hasSession && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-[#0a0a0a]">
            <div className="text-center">
              {projectId ? (
                <>
                  <div className="text-gray-500 text-xs mb-2">
                    No active session
                  </div>
                  <button
                    onClick={handleStart}
                    disabled={loading}
                    className="px-3 py-1.5 rounded bg-white/5 text-gray-300 hover:bg-white/10 transition-colors text-xs disabled:opacity-50"
                  >
                    {loading ? "Starting..." : "Start Session"}
                  </button>
                </>
              ) : (
                <div className="text-gray-600 text-xs font-mono">
                  Select a project
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function SplitView({
  leftProjectId,
  rightProjectId,
  projects,
  sessions,
  onSessionChange,
  onActivityChange,
}: SplitViewProps) {
  const terminalManager = useTerminalManager();
  const [leftId, setLeftId] = useState<string | null>(leftProjectId);
  const [rightId, setRightId] = useState<string | null>(rightProjectId);

  // Sync with props when they change
  useEffect(() => {
    setLeftId(leftProjectId);
  }, [leftProjectId]);

  useEffect(() => {
    setRightId(rightProjectId);
  }, [rightProjectId]);

  const isSplit = leftId !== null && rightId !== null;

  // Refit both terminals after divider drag
  const handleResizeEnd = useCallback(() => {
    if (leftId) terminalManager.fitInstance(leftId);
    if (rightId) terminalManager.fitInstance(rightId);
  }, [leftId, rightId, terminalManager]);

  const { leftPercent, isDragging, handleMouseDown, containerRef } =
    useSplitResize({
      minPercent: 25,
      initialPercent: 50,
      onResizeEnd: handleResizeEnd,
    });

  // Activity tracking: poll last-output timestamps
  const lastOutputRef = useRef<Map<string, number>>(new Map());
  const activityRef = useRef<Record<string, SessionActivity>>({});

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      const newActivity: Record<string, SessionActivity> = {};

      for (const [pid, lastTime] of lastOutputRef.current) {
        const prev = activityRef.current[pid];
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

    return () => clearInterval(timer);
  }, [onActivityChange]);

  // Single-pane mode: just show one pane full width
  if (!isSplit) {
    const soloId = leftId ?? rightId;
    return (
      <div className="flex-1 flex flex-row min-h-0">
        <SplitPane
          projectId={soloId}
          projects={projects}
          sessions={sessions}
          terminalManager={terminalManager}
          onSessionChange={onSessionChange}
          onSelectProject={(id) => setLeftId(id)}
        />
      </div>
    );
  }

  // Split-pane mode
  return (
    <div
      ref={containerRef}
      className={`flex-1 flex flex-row min-h-0 ${isDragging ? "select-none" : ""}`}
    >
      {/* Left pane */}
      <div
        className="flex flex-col min-w-0 min-h-0"
        style={{ width: `${leftPercent}%` }}
      >
        <SplitPane
          projectId={leftId}
          projects={projects}
          sessions={sessions}
          terminalManager={terminalManager}
          onSessionChange={onSessionChange}
          onSelectProject={setLeftId}
        />
      </div>

      {/* Divider */}
      <div
        onMouseDown={handleMouseDown}
        className={`w-1 shrink-0 cursor-col-resize transition-colors ${
          isDragging
            ? "bg-purple-500/70"
            : "bg-gray-800 hover:bg-purple-500/50"
        }`}
      />

      {/* Right pane */}
      <div
        className="flex flex-col min-w-0 min-h-0"
        style={{ width: `${100 - leftPercent}%` }}
      >
        <SplitPane
          projectId={rightId}
          projects={projects}
          sessions={sessions}
          terminalManager={terminalManager}
          onSessionChange={onSessionChange}
          onSelectProject={setRightId}
        />
      </div>
    </div>
  );
}
