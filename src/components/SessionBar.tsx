import type { ProjectConfig, SessionStatus } from "../types";
import type { SessionActivity } from "./Terminal";

const ACTIVITY_COLORS: Record<SessionActivity, string> = {
  working: "#22c55e",
  waiting: "#eab308",
  blocked: "#ef4444",
};

const ACTIVITY_LABELS: Record<SessionActivity, string> = {
  working: "Working",
  waiting: "Idle",
  blocked: "BLOCKED",
};

interface SessionBarProps {
  projects: ProjectConfig[];
  sessions: SessionStatus[];
  activity: Record<string, SessionActivity>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function formatDuration(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const mins = Math.floor((now - start) / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h${rem > 0 ? `${rem}m` : ""}`;
}

export function SessionBar({
  projects,
  sessions,
  activity,
  selectedId,
  onSelect,
}: SessionBarProps) {
  if (sessions.length === 0) return null;

  const projectMap = new Map(projects.map((p) => [p.id, p]));

  return (
    <div className="h-9 shrink-0 bg-[#0d0d0d] border-b border-gray-800 flex items-center px-2 gap-1 overflow-x-auto">
      <span className="text-[10px] text-gray-600 uppercase tracking-wider mr-2 shrink-0">
        Active
      </span>
      {sessions.map((session) => {
        const project = projectMap.get(session.projectId);
        if (!project) return null;

        const isSelected = selectedId === session.projectId;
        const act = activity[session.projectId];
        const dotColor = act
          ? ACTIVITY_COLORS[act]
          : project.color ?? "#22c55e";
        const label = act ? ACTIVITY_LABELS[act] : "Active";

        return (
          <button
            key={session.projectId}
            onClick={() => onSelect(session.projectId)}
            className={`flex items-center gap-2 px-3 py-1 rounded text-xs transition-colors shrink-0 ${
              isSelected
                ? "bg-white/8 text-white"
                : "text-gray-400 hover:bg-white/[0.03] hover:text-gray-300"
            }`}
          >
            {/* Activity dot */}
            <span className="relative flex h-2 w-2 shrink-0">
              {act === "working" && (
                <span
                  className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-50"
                  style={{ backgroundColor: dotColor }}
                />
              )}
              <span
                className="relative inline-flex h-2 w-2 rounded-full"
                style={{ backgroundColor: dotColor }}
              />
            </span>

            {/* Project name */}
            <span className="font-medium">{project.name}</span>

            {/* Status label */}
            <span
              className="text-[9px] px-1 py-0.5 rounded"
              style={{
                backgroundColor: `${dotColor}15`,
                color: dotColor,
              }}
            >
              {label}
            </span>

            {/* Duration */}
            {session.startedAt && (
              <span className="text-[9px] text-gray-600">
                {formatDuration(session.startedAt)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
