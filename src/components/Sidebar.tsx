import type { ProjectConfig, SessionStatus } from "../types";
import type { SessionActivity } from "./Terminal";

const CATEGORY_LABELS: Record<ProjectConfig["category"], string> = {
  game: "Games",
  app: "Apps",
  framework: "Frameworks",
  infra: "Infrastructure",
  personal: "Personal",
  adhoc: "Ad-hoc Sessions",
  discovered: "Other Repos",
};

const ACTIVITY_COLORS: Record<SessionActivity, string> = {
  working: "#22c55e",
  waiting: "#eab308",
  blocked: "#ef4444",
};

const ACTIVITY_LABELS: Record<SessionActivity, string> = {
  working: "Working",
  waiting: "Idle",
  blocked: "Needs input",
};

interface SidebarProps {
  projects: Record<string, ProjectConfig[]>;
  sessions: SessionStatus[];
  activity: Record<string, SessionActivity>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewSession?: () => void;
}

export function Sidebar({
  projects,
  sessions,
  activity,
  selectedId,
  onSelect,
  onNewSession,
}: SidebarProps) {
  const sessionSet = new Set(sessions.map((s) => s.projectId));
  const activeCount = sessions.length;
  const blockedCount = Object.values(activity).filter(
    (a) => a === "blocked",
  ).length;

  return (
    <aside className="w-[280px] min-w-[280px] bg-[#111] border-r border-gray-800 flex flex-col">
      <div className="px-4 py-3 border-b border-gray-800">
        <h1 className="text-sm font-semibold tracking-wide text-gray-400 uppercase">
          Claude CC
        </h1>
      </div>

      <div className="px-4 py-2 border-b border-gray-800/50 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
          Projects
        </span>
        <div className="flex items-center gap-2">
          {onNewSession && (
            <button
              onClick={onNewSession}
              className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200 transition-colors"
              title="New ad-hoc session (any directory)"
            >
              + New
            </button>
          )}
          <span className="text-[10px] text-gray-600">Ctrl+K</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-1">
        {Object.entries(projects).map(([category, categoryProjects]) => (
          <div key={category} className="mb-2">
            <div className="px-4 py-1.5">
              <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
                {CATEGORY_LABELS[category as ProjectConfig["category"]]}
              </span>
            </div>
            {categoryProjects.map((project) => {
              const hasSession = sessionSet.has(project.id);
              const isSelected = selectedId === project.id;
              const act = activity[project.id];
              const dotColor = hasSession
                ? act
                  ? ACTIVITY_COLORS[act]
                  : project.color ?? "#22c55e"
                : undefined;

              return (
                <button
                  key={project.id}
                  onClick={() => onSelect(project.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                    isSelected
                      ? "bg-white/5 text-white"
                      : "text-gray-400 hover:bg-white/[0.02] hover:text-gray-300"
                  }`}
                >
                  {/* Status dot */}
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    {hasSession && act === "working" && (
                      <span
                        className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-50"
                        style={{ backgroundColor: dotColor }}
                      />
                    )}
                    {hasSession && act === "blocked" && (
                      <span
                        className="absolute inline-flex h-full w-full animate-pulse rounded-full opacity-60"
                        style={{ backgroundColor: dotColor }}
                      />
                    )}
                    <span
                      className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                        hasSession ? "" : "bg-gray-700"
                      }`}
                      style={
                        hasSession ? { backgroundColor: dotColor } : undefined
                      }
                    />
                  </span>

                  <span className="text-sm truncate flex-1">{project.name}</span>

                  {/* Status label for active sessions */}
                  {hasSession && act && (
                    <span
                      className="text-[9px] px-1 py-0.5 rounded shrink-0"
                      style={{
                        backgroundColor: `${ACTIVITY_COLORS[act]}15`,
                        color: ACTIVITY_COLORS[act],
                      }}
                    >
                      {ACTIVITY_LABELS[act]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-gray-800 text-xs text-gray-600 flex justify-between">
        <span>
          {activeCount} session{activeCount !== 1 ? "s" : ""}
        </span>
        {blockedCount > 0 && (
          <span className="text-red-400">
            {blockedCount} blocked
          </span>
        )}
      </div>
    </aside>
  );
}
