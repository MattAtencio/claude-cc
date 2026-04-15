import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ToolConfig } from "../types";

const DEFAULT_ICONS: Record<ToolConfig["type"], string> = {
  vscode: "\uD83D\uDCBB",
  obsidian: "\uD83D\uDCDD",
  browser: "\uD83C\uDF10",
  aseprite: "\uD83C\uDFA8",
  slack: "\uD83D\uDCAC",
  discord: "\uD83C\uDFAE",
  terminal: "\u2B1B",
  unity: "\uD83C\uDFAE",
  custom: "\u2699\uFE0F",
};

interface ToolBarProps {
  tools: ToolConfig[];
  projectPath?: string;
}

export function ToolBar({ tools, projectPath }: ToolBarProps) {
  const [activeTool, setActiveTool] = useState<string | null>(null);

  async function handleLaunch(tool: ToolConfig) {
    setActiveTool(tool.name);
    try {
      await invoke("launch_program", {
        toolType: tool.type,
        command: tool.command ?? null,
        path: tool.path ?? null,
      });
    } catch (err) {
      console.error("Failed to launch program:", err);
    }
  }

  return (
    <div className="h-12 shrink-0 bg-[#0d0d0d] border-t border-gray-800 flex items-center px-3 gap-1">
      {tools.map((tool) => {
        const isActive = activeTool === tool.name;
        const icon = tool.icon ?? DEFAULT_ICONS[tool.type] ?? "\u2699\uFE0F";

        return (
          <button
            key={tool.name}
            onClick={() => handleLaunch(tool)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors ${
              isActive
                ? "bg-white/10 text-white"
                : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
            }`}
            title={tool.name}
          >
            <span className="text-sm">{icon}</span>
            <span>{tool.name}</span>
          </button>
        );
      })}
      <div className="flex-1" />
      <span className="text-[10px] text-gray-700 font-mono">{projectPath}</span>
    </div>
  );
}
