export interface ProjectConfig {
  id: string;
  name: string;
  path: string;
  tools: ToolConfig[];
  color?: string;
  category: "main" | "game" | "app" | "framework" | "infra" | "personal" | "adhoc" | "discovered";
}

export interface AppSettings {
  devRoot?: string;
  mainLabel?: string;
}

export interface ToolConfig {
  name: string;
  type:
    | "vscode"
    | "obsidian"
    | "browser"
    | "aseprite"
    | "slack"
    | "discord"
    | "terminal"
    | "unity"
    | "custom";
  command?: string;
  path?: string;
  icon?: string;
}

export interface SessionInfo {
  id: string;
  projectId: string;
  status: "active" | "waiting" | "idle" | "stopped";
  pid?: number;
  startedAt: string;
}

export interface SessionStatus {
  projectId: string;
  active: boolean;
  pid?: number;
  status: "active" | "waiting" | "idle" | "stopped";
  startedAt: string;
}

export interface ClaudeProcess {
  pid: number;
  title: string;
  projectId?: string;
}
