export type TimelineStepType =
  | "tool-call"
  | "approval"
  | "commit"
  | "test-pass"
  | "test-fail"
  | "deploy"
  | "error"
  | "output";

export interface TimelineStep {
  id: string;
  type: TimelineStepType;
  name: string;
  detail?: string;
  timestamp: number;
  duration?: number;
}

export interface TimelinePhase {
  id: string;
  name: string;
  startedAt: number;
  endedAt?: number;
  status: "active" | "completed";
  steps: TimelineStep[];
  toolCalls: number;
  approvals: number;
}

export interface TimelineMetrics {
  startedAt: number;
  totalToolCalls: number;
  toolCallsByType: Record<string, number>;
  totalApprovals: number;
  stateChanges: number;
  currentState: string;
  estimatedCost?: string;
  phases: TimelinePhase[];
}
