import type { ProjectConfig, SessionStatus } from "../types";
import type { SessionActivity } from "./Terminal";

const CATEGORY_LABELS: Record<ProjectConfig["category"], string> = {
  main: "Command Center",
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
          Command
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
        {Object.entries(projects).map(([category, categoryProjects]) => {
          const isMain = category === "main";

          return (
            <div key={category} className={isMain ? "mb-1" : "mb-2"}>
              {/* Main projects get prominent header */}
              {isMain ? (
                <div className="px-3 py-1">
                  <span className="text-[10px] font-bold text-purple-400/70 uppercase tracking-widest">
                    {CATEGORY_LABELS[category as ProjectConfig["category"]]}
                  </span>
                </div>
              ) : (
                <div className="px-4 py-1.5">
                  <span className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest">
                    {CATEGORY_LABELS[category as ProjectConfig["category"]]}
                  </span>
                </div>
              )}

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
                    className={`w-full flex items-center gap-3 px-4 text-left transition-colors ${
                      isMain ? "py-2.5" : "py-2"
                    } ${
                      isSelected
                        ? isMain
                          ? "bg-purple-500/10 text-white"
                          : "bg-white/5 text-white"
                        : isMain
                          ? "text-gray-300 hover:bg-purple-500/5 hover:text-white"
                          : "text-gray-400 hover:bg-white/[0.02] hover:text-gray-300"
                    }`}
                  >
                    {/* Status dot — main gets a larger one */}
                    <span className={`relative flex shrink-0 ${isMain ? "h-3 w-3" : "h-2.5 w-2.5"}`}>
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
                        className={`relative inline-flex rounded-full ${isMain ? "h-3 w-3" : "h-2.5 w-2.5"} ${
                          hasSession ? "" : isMain ? "bg-purple-900/50 ring-1 ring-purple-500/30" : "bg-gray-700"
                        }`}
                        style={
                          hasSession ? { backgroundColor: dotColor } : undefined
                        }
                      />
                    </span>

                    <span className={`truncate flex-1 ${isMain ? "text-sm font-medium" : "text-sm"}`}>
                      {project.name}
                    </span>

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

              {/* Divider after main section */}
              {isMain && (
                <div className="mx-3 mt-1 mb-2 border-b border-purple-500/10" />
              )}
            </div>
          );
        })}
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
