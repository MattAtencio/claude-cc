import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useProjects } from "./hooks/useProjects";
import { Sidebar } from "./components/Sidebar";
import { SessionBar } from "./components/SessionBar";
import { TerminalView, type SessionActivity } from "./components/Terminal";
import { ToolBar } from "./components/ToolBar";
import CommandPalette from "./components/CommandPalette";
import { TimelinePanel } from "./components/TimelinePanel";
import { SetupScreen } from "./components/SetupScreen";
import { useTimeline } from "./hooks/useTimeline";
import type { SessionStatus } from "./types";

// Map backend SessionState strings to frontend activity
function mapStateToActivity(state: string): SessionActivity {
  switch (state) {
    case "Streaming":
    case "Thinking":
    case "ToolUse":
      return "working";
    case "PermissionBlocked":
      return "blocked";
    case "Waiting":
    case "Starting":
    case "Completed":
    default:
      return "waiting";
  }
}

function App() {
  const { projects, grouped, loading } = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionStatus[]>([]);
  const [activity, setActivity] = useState<Record<string, SessionActivity>>({});
  const [paletteOpen, setPaletteOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stateListenersRef = useRef<Map<string, () => void>>(new Map());

  // Auto-select first project
  useEffect(() => {
    if (projects.length > 0 && selectedProjectId === null) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  // Poll session status
  const pollSessions = useCallback(async () => {
    try {
      const result = await invoke<SessionStatus[]>("get_sessions_status");
      setSessions(result);

      // Update activity from backend state
      const newActivity: Record<string, SessionActivity> = {};
      for (const s of result) {
        newActivity[s.projectId] = mapStateToActivity(s.status);
      }
      setActivity((prev) => {
        // Only update if changed
        const changed = Object.keys(newActivity).some(
          (k) => prev[k] !== newActivity[k],
        );
        if (changed || Object.keys(prev).length !== Object.keys(newActivity).length) {
          return newActivity;
        }
        return prev;
      });

      // Subscribe to state events for new sessions
      for (const s of result) {
        if (!stateListenersRef.current.has(s.projectId)) {
          const pid = s.projectId;
          listen<string>(`session-state-${pid}`, (event) => {
            setActivity((prev) => ({
              ...prev,
              [pid]: mapStateToActivity(event.payload),
            }));
          }).then((unlisten) => {
            stateListenersRef.current.set(pid, unlisten);
          });
        }
      }

      // Unsubscribe from removed sessions
      for (const [pid, unlisten] of stateListenersRef.current) {
        if (!result.find((s) => s.projectId === pid)) {
          unlisten();
          stateListenersRef.current.delete(pid);
          setActivity((prev) => {
            const next = { ...prev };
            delete next[pid];
            return next;
          });
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    pollSessions();
    pollRef.current = setInterval(pollSessions, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      // Cleanup all listeners
      for (const [, unlisten] of stateListenersRef.current) {
        unlisten();
      }
      stateListenersRef.current.clear();
    };
  }, [pollSessions]);

  // Reconnect saved sessions on app launch
  useEffect(() => {
    async function reconnectSaved() {
      try {
        const saved = await invoke<
          { project_id: string; claude_session_id: string | null }[]
        >("get_saved_sessions");
        for (const s of saved) {
          if (s.claude_session_id) {
            try {
              await invoke("reconnect_saved_session", {
                projectId: s.project_id,
                sessionId: s.claude_session_id,
              });
            } catch {
              // Session may have expired, ignore
            }
          }
        }
        // Re-poll after reconnecting
        await pollSessions();
      } catch {}
    }
    reconnectSaved();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl+K: command palette
      if (e.ctrlKey && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }

      // Don't handle other shortcuts if palette is open
      if (paletteOpen) return;

      if (!e.ctrlKey) return;

      // Ctrl+1-9: switch to Nth active session
      if (e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx < sessions.length) {
          setSelectedProjectId(sessions[idx].projectId);
        }
        return;
      }

      // Ctrl+[ / Ctrl+]: cycle projects
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        const currentIdx = projects.findIndex((p) => p.id === selectedProjectId);
        if (currentIdx === -1) return;
        const next =
          e.key === "]"
            ? (currentIdx + 1) % projects.length
            : (currentIdx - 1 + projects.length) % projects.length;
        setSelectedProjectId(projects[next].id);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [projects, sessions, selectedProjectId, paletteOpen]);

  const activeProject = projects.find((p) => p.id === selectedProjectId);
  const sessionSet = new Set(sessions.map((s) => s.projectId));
  const hasActiveSession = selectedProjectId ? sessionSet.has(selectedProjectId) : false;
  const { timeline } = useTimeline(selectedProjectId, hasActiveSession);

  // New ad-hoc session handler
  const handleNewSession = useCallback(async () => {
    const path = window.prompt(
      "Enter directory path for new session:",
      "",
    );
    if (!path) return;

    // Derive a name and ID from the path
    const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
    const name = parts[parts.length - 1] || "adhoc";
    const id = `adhoc-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Date.now()}`;

    try {
      await invoke("create_adhoc_session", {
        sessionId: id,
        path,
        name,
      });
      setSelectedProjectId(id);
      pollSessions();
    } catch (err) {
      console.error("Failed to create ad-hoc session:", err);
    }
  }, [pollSessions]);

  // Command palette action handlers
  const handleStartSession = useCallback(
    async (id: string) => {
      try {
        await invoke("create_session", { projectId: id });
        setSelectedProjectId(id);
        pollSessions();
      } catch {}
    },
    [pollSessions],
  );

  const handleStopSession = useCallback(
    async (id: string) => {
      try {
        await invoke("close_session", { projectId: id });
        pollSessions();
      } catch {}
    },
    [pollSessions],
  );

  const handleLaunchTool = useCallback(
    async (toolType: string, command?: string, path?: string) => {
      try {
        await invoke("launch_program", {
          toolType,
          command: command ?? null,
          path: path ?? null,
        });
      } catch {}
    },
    [],
  );

  if (loading) {
    return (
      <div className="flex h-screen w-screen bg-[#0a0a0a] text-gray-200 items-center justify-center">
        <div className="text-gray-600 text-sm font-mono">Loading projects...</div>
      </div>
    );
  }

  if (projects.length === 0) {
    return <SetupScreen />;
  }

  return (
    <div className="flex h-screen w-screen bg-[#0a0a0a] text-gray-200 overflow-hidden">
      <Sidebar
        projects={grouped}
        sessions={sessions}
        activity={activity}
        selectedId={selectedProjectId}
        onSelect={setSelectedProjectId}
        onNewSession={handleNewSession}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <SessionBar
          projects={projects}
          sessions={sessions}
          activity={activity}
          selectedId={selectedProjectId}
          onSelect={setSelectedProjectId}
        />

        <div className="flex-1 flex min-h-0 overflow-hidden">
          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
            <TerminalView
              projectId={selectedProjectId}
              projectName={activeProject?.name}
              projectColor={activeProject?.color}
              sessions={sessions}
              onSessionChange={pollSessions}
              onActivityChange={setActivity}
            />

            <ToolBar
              tools={activeProject?.tools ?? []}
              projectPath={activeProject?.path}
            />
          </div>

          <TimelinePanel
            timeline={timeline}
            projectId={selectedProjectId}
            hasActiveSession={hasActiveSession}
          />
        </div>
      </div>

      {/* Command Palette */}
      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        projects={projects}
        sessions={sessions}
        onSelectProject={setSelectedProjectId}
        onStartSession={handleStartSession}
        onStopSession={handleStopSession}
        onLaunchTool={handleLaunchTool}
      />
    </div>
  );
}

export default App;
