import { useState } from "react";
import type { SessionTimeline, Wave, Activity, ToolCall } from "../types/timeline";
import { formatTokens } from "../hooks/useTimeline";

function formatDuration(start: number, end?: number): string {
  const ms = (end ?? Date.now()) - start;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

const ACTIVITY_COLORS: Record<Activity["type"], string> = {
  research: "#60a5fa",
  implementation: "#c084fc",
  testing: "#22c55e",
  approval: "#ef4444",
  commit: "#22c55e",
  deploy: "#3b82f6",
  error: "#ef4444",
};

const ACTIVITY_ICONS: Record<Activity["type"], string> = {
  research: "🔍",
  implementation: "⚙",
  testing: "▶",
  approval: "⚠",
  commit: "✓",
  deploy: "🚀",
  error: "✗",
};

const TOOL_COLORS: Record<string, string> = {
  Read: "#60a5fa",
  Edit: "#c084fc",
  Write: "#22d3ee",
  Bash: "#f59e0b",
  Grep: "#4ade80",
  Glob: "#4ade80",
  Agent: "#f472b6",
  WebSearch: "#fb923c",
  WebFetch: "#fb923c",
};

// --- Tool call row (level 3) ---

function ToolCallRow({ tc }: { tc: ToolCall }) {
  const color = TOOL_COLORS[tc.tool] ?? "#6b7280";
  const hasTokens = tc.tokens.input > 0 || tc.tokens.output > 0;

  return (
    <div className="flex items-start gap-1.5 py-0.5 text-[10px]">
      <span className="shrink-0 font-mono font-medium" style={{ color }}>
        {tc.tool}
      </span>
      <span className="text-gray-600 truncate flex-1 min-w-0">
        {tc.detail.replace(/^⚙\s*\w+\s*/, "").replace(/^\w+\(/, "(") || ""}
      </span>
      {hasTokens && (
        <span className="text-gray-700 shrink-0 font-mono">
          {formatTokens(tc.tokens.input)}/{formatTokens(tc.tokens.output)}
        </span>
      )}
    </div>
  );
}

// --- Activity row (level 2) ---

function ActivityRow({ activity }: { activity: Activity }) {
  const [expanded, setExpanded] = useState(false);
  const color = ACTIVITY_COLORS[activity.type];
  const icon = ACTIVITY_ICONS[activity.type];
  const hasChildren = activity.toolCalls.length > 0;
  const hasTokens = activity.tokens.input > 0 || activity.tokens.output > 0;

  // Summary of tool types for collapsed view
  const toolSummary = activity.toolCalls.length > 0
    ? (() => {
        const counts: Record<string, number> = {};
        for (const tc of activity.toolCalls) {
          counts[tc.tool] = (counts[tc.tool] || 0) + 1;
        }
        return Object.entries(counts)
          .sort(([, a], [, b]) => b - a)
          .map(([t, c]) => `${c} ${t.toLowerCase()}`)
          .join(", ");
      })()
    : "";

  return (
    <div className="mb-0.5">
      <button
        onClick={() => hasChildren && setExpanded(!expanded)}
        className={`w-full flex items-start gap-1.5 px-1 py-1 rounded text-left transition-colors ${
          hasChildren ? "hover:bg-white/[0.03] cursor-pointer" : "cursor-default"
        }`}
      >
        {/* Expand arrow or spacer */}
        <span className="text-[9px] text-gray-600 mt-0.5 w-3 shrink-0 text-center">
          {hasChildren ? (expanded ? "▾" : "▸") : ""}
        </span>

        {/* Icon */}
        <span className="shrink-0 text-[11px]" style={{ color }}>{icon}</span>

        {/* Label */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-gray-300 truncate">{activity.label}</span>
          </div>
          {!expanded && toolSummary && (
            <span className="text-[9px] text-gray-600">({toolSummary})</span>
          )}
        </div>

        {/* Token count */}
        {hasTokens && (
          <span className="text-[9px] text-gray-600 font-mono shrink-0">
            ({formatTokens(activity.tokens.input)}/{formatTokens(activity.tokens.output)})
          </span>
        )}
      </button>

      {/* Expanded tool calls */}
      {expanded && hasChildren && (
        <div className="ml-7 pl-2 border-l border-gray-800/50 mb-1">
          {activity.toolCalls.map((tc) => (
            <ToolCallRow key={tc.id} tc={tc} />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Wave section (level 1) ---

function WaveSection({ wave, defaultOpen }: { wave: Wave; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const isActive = wave.status === "active";
  const hasTokens = wave.tokens.input > 0 || wave.tokens.output > 0;

  const toolCount = wave.activities.reduce((s, a) => s + a.toolCalls.length, 0);
  const approvalCount = wave.activities.filter((a) => a.type === "approval").length;

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.03] transition-colors text-left"
      >
        <span className="text-[10px] text-gray-600 shrink-0">{open ? "▾" : "▸"}</span>
        <span className="relative flex h-2 w-2 shrink-0">
          {isActive && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-500 opacity-40" />
          )}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${isActive ? "bg-purple-500" : "bg-gray-600"}`} />
        </span>
        <span className={`text-[11px] font-medium flex-1 ${isActive ? "text-gray-200" : "text-gray-400"}`}>
          {wave.name}
        </span>
        {hasTokens && (
          <span className="text-[9px] text-gray-600 font-mono shrink-0">
            ({formatTokens(wave.tokens.input)}/{formatTokens(wave.tokens.output)})
          </span>
        )}
        <span className="text-[9px] text-gray-600 shrink-0">{formatDuration(wave.startedAt, wave.endedAt)}</span>
      </button>

      {open && (
        <div className="ml-4 pl-2 border-l border-gray-800/50">
          {/* Wave summary */}
          <div className="flex gap-3 px-1 py-0.5 text-[9px] text-gray-600">
            {toolCount > 0 && <span>{toolCount} tools</span>}
            {approvalCount > 0 && <span className="text-red-400/60">{approvalCount} approvals</span>}
            <span>{wave.activities.length} activities</span>
          </div>

          {/* Activities */}
          {wave.activities.map((act) => (
            <ActivityRow key={act.id} activity={act} />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Metrics bar ---

function MetricPill({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex flex-col items-center px-2 py-1">
      <span className="text-[13px] font-bold" style={{ color: color ?? "#e5e5e5" }}>{value}</span>
      <span className="text-[8px] text-gray-600 uppercase tracking-wider">{label}</span>
    </div>
  );
}

// --- Main panel ---

interface TimelinePanelProps {
  timeline: SessionTimeline | null;
  projectId: string | null;
  hasActiveSession: boolean;
}

export function TimelinePanel({ timeline, projectId, hasActiveSession }: TimelinePanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div className="w-8 bg-[#111] border-l border-gray-800 flex flex-col items-center pt-3">
        <button
          onClick={() => setCollapsed(false)}
          className="text-gray-600 hover:text-gray-400 transition-colors text-[10px]"
          style={{ writingMode: "vertical-rl" }}
          title="Expand timeline"
        >
          Timeline
        </button>
      </div>
    );
  }

  if (!projectId || !hasActiveSession || !timeline) {
    return (
      <div className="w-[280px] min-w-[280px] bg-[#111] border-l border-gray-800 flex flex-col">
        <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Timeline</span>
          <button onClick={() => setCollapsed(true)} className="text-gray-600 hover:text-gray-400 text-xs">&rsaquo;</button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <span className="text-[11px] text-gray-700">Start a session to see timeline</span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-[280px] min-w-[280px] bg-[#111] border-l border-gray-800 flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Timeline</span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-gray-600">{formatDuration(timeline.startedAt)}</span>
          <button onClick={() => setCollapsed(true)} className="text-gray-600 hover:text-gray-400 text-xs">&rsaquo;</button>
        </div>
      </div>

      {/* Metrics bar */}
      <div className="border-b border-gray-800/50 flex items-center justify-around py-1">
        <MetricPill label="Tools" value={timeline.totalToolCalls} color="#a855f7" />
        <MetricPill label="Approvals" value={timeline.totalApprovals} color="#ef4444" />
        <MetricPill label="Waves" value={timeline.waves.length} color="#60a5fa" />
        <MetricPill
          label="Cost"
          value={`~$${timeline.estimatedCost}`}
          color="#f59e0b"
        />
      </div>

      {/* Token totals */}
      <div className="border-b border-gray-800/50 px-3 py-1 flex items-center justify-between text-[9px] text-gray-500 font-mono">
        <span>Tokens: {formatTokens(timeline.totalTokens.input)} in / {formatTokens(timeline.totalTokens.output)} out</span>
      </div>

      {/* Wave tree */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {timeline.waves.map((wave, i) => (
          <WaveSection
            key={wave.id}
            wave={wave}
            defaultOpen={i === timeline.waves.length - 1}
          />
        ))}
      </div>
    </div>
  );
}
