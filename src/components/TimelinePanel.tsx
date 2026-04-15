import { useState } from "react";
import type { TimelineMetrics, TimelinePhase, TimelineStep } from "../types/timeline";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

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

const STEP_COLORS: Record<string, string> = {
  "tool-call": "#a855f7",
  approval: "#ef4444",
  commit: "#22c55e",
  "state-change": "#6b7280",
  output: "#6b7280",
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

function StepIcon({ type }: { type: string }) {
  const color = STEP_COLORS[type] ?? "#6b7280";
  if (type === "tool-call") {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill={color}>
        <path d="M8.837 1.626c-.246-.835-1.428-.835-1.674 0l-.094.319A1.873 1.873 0 0 1 4.377 3.06l-.292-.16c-.764-.415-1.6.42-1.184 1.185l.159.292a1.873 1.873 0 0 1-1.115 2.692l-.319.094c-.835.246-.835 1.428 0 1.674l.319.094a1.873 1.873 0 0 1 1.115 2.693l-.16.291c-.415.764.42 1.6 1.185 1.184l.292-.159a1.873 1.873 0 0 1 2.692 1.116l.094.318c.246.835 1.428.835 1.674 0l.094-.318a1.873 1.873 0 0 1 2.693-1.116l.291.16c.764.415 1.6-.42 1.184-1.185l-.159-.291a1.873 1.873 0 0 1 1.116-2.693l.318-.094c.835-.246.835-1.428 0-1.674l-.318-.094a1.873 1.873 0 0 1-1.116-2.692l.16-.292c.415-.764-.42-1.6-1.185-1.184l-.291.159A1.873 1.873 0 0 1 8.93 1.945l-.094-.319zm-2.633 7.353a2.7 2.7 0 1 1 3.591-4.018 2.7 2.7 0 0 1-3.59 4.017z"/>
      </svg>
    );
  }
  if (type === "approval") {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill={color}>
        <path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/>
      </svg>
    );
  }
  if (type === "commit") {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill={color}>
        <path d="M12.736 3.97a.733.733 0 0 1 1.047 0c.286.289.29.756.01 1.05L7.88 12.01a.733.733 0 0 1-1.065.02L3.217 8.384a.757.757 0 0 1 0-1.06.733.733 0 0 1 1.047 0l3.052 3.093 5.4-6.425z"/>
      </svg>
    );
  }
  return (
    <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: color }} />
  );
}

function StepRow({ step }: { step: TimelineStep }) {
  const toolColor = step.type === "tool-call" ? TOOL_COLORS[step.name] ?? "#a855f7" : undefined;

  return (
    <div className="flex items-start gap-2 py-0.5 group">
      <span className="mt-0.5 shrink-0 opacity-70 group-hover:opacity-100">
        <StepIcon type={step.type} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className="text-[11px] font-medium"
            style={{ color: toolColor ?? STEP_COLORS[step.type] ?? "#9ca3af" }}
          >
            {step.name}
          </span>
          <span className="text-[9px] text-gray-600">{formatTime(step.timestamp)}</span>
        </div>
        {step.detail && (
          <div className="text-[10px] text-gray-600 truncate max-w-full">{step.detail}</div>
        )}
      </div>
    </div>
  );
}

function PhaseSection({ phase, defaultOpen }: { phase: TimelinePhase; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const isActive = phase.status === "active";

  return (
    <div className="mb-1">
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
        <span className={`text-[11px] font-medium flex-1 ${isActive ? "text-gray-200" : "text-gray-500"}`}>
          {phase.name}
        </span>
        <span className="text-[9px] text-gray-600">{formatDuration(phase.startedAt, phase.endedAt)}</span>
      </button>

      {open && (
        <div className="ml-4 pl-2 border-l border-gray-800/50">
          {/* Phase summary */}
          <div className="flex gap-3 px-2 py-1 text-[9px] text-gray-600">
            {phase.toolCalls > 0 && <span>{phase.toolCalls} tools</span>}
            {phase.approvals > 0 && <span className="text-red-400/60">{phase.approvals} approvals</span>}
            <span>{phase.steps.length} events</span>
          </div>

          {/* Steps */}
          <div className="px-1 space-y-0">
            {phase.steps.slice(-50).map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricPill({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex flex-col items-center px-2 py-1">
      <span className="text-[13px] font-bold" style={{ color: color ?? "#e5e5e5" }}>
        {value}
      </span>
      <span className="text-[8px] text-gray-600 uppercase tracking-wider">{label}</span>
    </div>
  );
}

interface TimelinePanelProps {
  metrics: TimelineMetrics | null;
  projectId: string | null;
  hasActiveSession: boolean;
}

export function TimelinePanel({ metrics, projectId, hasActiveSession }: TimelinePanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div className="w-8 bg-[#111] border-l border-gray-800 flex flex-col items-center pt-3">
        <button
          onClick={() => setCollapsed(false)}
          className="text-gray-600 hover:text-gray-400 transition-colors text-[10px] writing-vertical"
          style={{ writingMode: "vertical-rl" }}
          title="Expand timeline"
        >
          Timeline
        </button>
      </div>
    );
  }

  if (!projectId || !hasActiveSession || !metrics) {
    return (
      <div className="w-[280px] min-w-[280px] bg-[#111] border-l border-gray-800 flex flex-col">
        <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Timeline</span>
          <button onClick={() => setCollapsed(true)} className="text-gray-600 hover:text-gray-400 text-xs">
            &rsaquo;
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <span className="text-[11px] text-gray-700">Start a session to see timeline</span>
        </div>
      </div>
    );
  }

  // Top tool types for display
  const topTools = Object.entries(metrics.toolCallsByType)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6);

  return (
    <div className="w-[280px] min-w-[280px] bg-[#111] border-l border-gray-800 flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Timeline</span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-gray-600">{formatDuration(metrics.startedAt)}</span>
          <button onClick={() => setCollapsed(true)} className="text-gray-600 hover:text-gray-400 text-xs">
            &rsaquo;
          </button>
        </div>
      </div>

      {/* Metrics bar */}
      <div className="border-b border-gray-800/50 flex items-center justify-around py-1">
        <MetricPill label="Tools" value={metrics.totalToolCalls} color="#a855f7" />
        <MetricPill label="Approvals" value={metrics.totalApprovals} color="#ef4444" />
        <MetricPill label="Phases" value={metrics.phases.length} color="#60a5fa" />
      </div>

      {/* Tool breakdown */}
      {topTools.length > 0 && (
        <div className="border-b border-gray-800/50 px-3 py-1.5 flex flex-wrap gap-1">
          {topTools.map(([tool, count]) => (
            <span
              key={tool}
              className="text-[9px] px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: `${TOOL_COLORS[tool] ?? "#6b7280"}15`,
                color: TOOL_COLORS[tool] ?? "#6b7280",
              }}
            >
              {tool} {count}
            </span>
          ))}
        </div>
      )}

      {/* Phase tree */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {metrics.phases.map((phase, i) => (
          <PhaseSection
            key={phase.id}
            phase={phase}
            defaultOpen={i === metrics.phases.length - 1}
          />
        ))}
      </div>

      {/* Current state footer */}
      <div className="px-3 py-2 border-t border-gray-800 flex items-center justify-between">
        <span className="text-[9px] text-gray-600">State</span>
        <span className="text-[10px] font-medium text-gray-400">{metrics.currentState}</span>
      </div>
    </div>
  );
}
