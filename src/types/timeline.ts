export interface TokenUsage {
  input: number;
  output: number;
}

export interface ToolCall {
  id: string;
  tool: string;
  detail: string;
  timestamp: number;
  tokens: TokenUsage;
}

export interface Activity {
  id: string;
  type: "research" | "implementation" | "testing" | "approval" | "commit" | "deploy" | "error";
  label: string;
  startedAt: number;
  endedAt?: number;
  status: "active" | "completed";
  toolCalls: ToolCall[];
  tokens: TokenUsage;
}

export interface Wave {
  id: string;
  name: string;
  startedAt: number;
  endedAt?: number;
  status: "active" | "completed";
  activities: Activity[];
  tokens: TokenUsage;
}

export interface SessionTimeline {
  startedAt: number;
  waves: Wave[];
  totalTokens: TokenUsage;
  estimatedCost: string;
  totalToolCalls: number;
  totalApprovals: number;
}
