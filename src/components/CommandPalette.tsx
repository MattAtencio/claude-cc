import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectConfig, SessionStatus } from "../types";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  projects: ProjectConfig[];
  sessions: SessionStatus[];
  onSelectProject: (id: string) => void;
  onStartSession: (id: string) => void;
  onStopSession: (id: string) => void;
  onLaunchTool: (toolType: string, command?: string, path?: string) => void;
}

interface CommandItem {
  id: string;
  label: string;
  category: "Projects" | "Sessions" | "Tools" | "Meta";
  icon?: string;
  color?: string;
  shortcut?: string;
  action: () => void;
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export default function CommandPalette({
  isOpen,
  onClose,
  projects,
  sessions,
  onSelectProject,
  onStartSession,
  onStopSession,
  onLaunchTool,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const sessionMap = useMemo(() => {
    const map = new Map<string, SessionStatus>();
    for (const s of sessions) map.set(s.projectId, s);
    return map;
  }, [sessions]);

  const allCommands = useMemo<CommandItem[]>(() => {
    const cmds: CommandItem[] = [];

    // Project switch commands
    projects.forEach((p, i) => {
      cmds.push({
        id: `switch-${p.id}`,
        label: `Switch to ${p.name}`,
        category: "Projects",
        color: p.color || "#6b7280",
        shortcut: i < 9 ? `Ctrl+${i + 1}` : undefined,
        action: () => onSelectProject(p.id),
      });
    });

    // Session commands
    projects.forEach((p) => {
      const session = sessionMap.get(p.id);
      if (session?.active) {
        cmds.push({
          id: `stop-${p.id}`,
          label: `Stop session: ${p.name}`,
          category: "Sessions",
          color: "#ef4444",
          action: () => onStopSession(p.id),
        });
      } else {
        cmds.push({
          id: `start-${p.id}`,
          label: `Start session: ${p.name}`,
          category: "Sessions",
          color: "#22c55e",
          action: () => onStartSession(p.id),
        });
      }
    });

    // Tool commands for each project
    projects.forEach((p) => {
      p.tools.forEach((tool) => {
        cmds.push({
          id: `tool-${p.id}-${tool.type}-${tool.name}`,
          label: `Launch ${tool.name} for ${p.name}`,
          category: "Tools",
          icon: tool.icon,
          action: () => onLaunchTool(tool.type, tool.command, tool.path),
        });
      });
    });

    // Meta commands
    cmds.push({
      id: "open-config",
      label: "Open config",
      category: "Meta",
      shortcut: "Ctrl+,",
      action: () => onLaunchTool("config"),
    });

    return cmds;
  }, [projects, sessionMap, onSelectProject, onStartSession, onStopSession, onLaunchTool]);

  const filtered = useMemo(() => {
    if (!query.trim()) return allCommands;
    return allCommands.filter((cmd) => fuzzyMatch(query, cmd.label));
  }, [query, allCommands]);

  const limitedResults = filtered.slice(0, 15);

  // Group by category preserving order
  const grouped = useMemo(() => {
    const categoryOrder: CommandItem["category"][] = ["Projects", "Sessions", "Tools", "Meta"];
    const groups: { category: string; items: { item: CommandItem; flatIndex: number }[] }[] = [];
    let flatIndex = 0;

    for (const cat of categoryOrder) {
      const items = limitedResults
        .filter((c) => c.category === cat)
        .map((item) => ({ item, flatIndex: flatIndex++ }));
      if (items.length > 0) {
        groups.push({ category: cat, items });
      }
    }
    return groups;
  }, [limitedResults]);

  const flatCount = limitedResults.length;

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Global Ctrl+K listener
  useEffect(() => {
    // Only handle Escape here — Ctrl+K toggle is the parent's responsibility
    // since the parent owns isOpen state
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector("[data-selected='true']");
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const executeSelected = useCallback(() => {
    const item = limitedResults[selectedIndex];
    if (item) {
      item.action();
      onClose();
    }
  }, [limitedResults, selectedIndex, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % Math.max(flatCount, 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => (i - 1 + flatCount) % Math.max(flatCount, 1));
          break;
        case "Enter":
          e.preventDefault();
          executeSelected();
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [flatCount, executeSelected, onClose]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-2xl w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command..."
          className="bg-transparent border-b border-gray-700 text-white p-4 text-sm w-full outline-none placeholder-gray-500"
        />

        {/* Results */}
        <div ref={listRef} className="max-h-[360px] overflow-y-auto py-1">
          {flatCount === 0 ? (
            <div className="px-4 py-6 text-sm text-gray-500 text-center">
              No matching commands
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.category}>
                <div className="px-4 py-1.5 text-[10px] text-gray-600 uppercase tracking-wider select-none">
                  {group.category}
                </div>
                {group.items.map(({ item, flatIndex }) => (
                  <div
                    key={item.id}
                    data-selected={flatIndex === selectedIndex}
                    className={`flex items-center justify-between px-4 py-2.5 text-sm cursor-pointer ${
                      flatIndex === selectedIndex
                        ? "bg-white/10 text-white"
                        : "text-gray-300 hover:bg-white/5"
                    }`}
                    onClick={() => {
                      item.action();
                      onClose();
                    }}
                    onMouseEnter={() => setSelectedIndex(flatIndex)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {item.color && (
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: item.color }}
                        />
                      )}
                      <span className="truncate">{item.label}</span>
                    </div>
                    {item.shortcut && (
                      <span className="text-[10px] text-gray-600 ml-4 flex-shrink-0">
                        {item.shortcut}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
