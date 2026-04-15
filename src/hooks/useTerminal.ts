import { useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

const THEME = {
  background: "#0a0a0a",
  foreground: "#e5e5e5",
  cursor: "#a855f7",
  selectionBackground: "#a855f733",
  black: "#1a1a2e",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#e5e5e5",
  brightBlack: "#4a4a5a",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde68a",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#ffffff",
};

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  unlisten: UnlistenFn | null;
  onDataDispose: { dispose: () => void } | null;
  onResizeDispose: { dispose: () => void } | null;
  containerEl: HTMLDivElement | null;
}

/**
 * Manages MULTIPLE concurrent terminal instances — one per project session.
 * Terminals persist in memory even when not visible. Switching projects
 * just moves the DOM element, it doesn't destroy anything.
 */
export function useTerminalManager() {
  const instancesRef = useRef<Map<string, TerminalInstance>>(new Map());

  const createInstance = useCallback(
    async (projectId: string, container: HTMLDivElement) => {
      // If instance already exists, just re-attach to DOM
      const existing = instancesRef.current.get(projectId);
      if (existing) {
        if (existing.containerEl !== container) {
          // Move terminal to new container
          container.innerHTML = "";
          existing.terminal.open(container);
          existing.fitAddon.fit();
          existing.containerEl = container;
        }
        return;
      }

      // Create new terminal
      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
        theme: THEME,
        allowProposedApi: true,
        scrollback: 10000,
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(webLinksAddon);

      // Open in container
      terminal.open(container);
      fitAddon.fit();

      // Wire user input → PTY
      const onDataDispose = terminal.onData((data: string) => {
        invoke("write_to_session", { projectId, data }).catch(() => {});
      });

      // Wire resize → PTY
      const onResizeDispose = terminal.onResize(({ cols, rows }) => {
        invoke("resize_session", { projectId, rows, cols }).catch(() => {});
      });

      // Wire PTY output → terminal
      const unlisten = await listen<string>(
        `pty-output-${projectId}`,
        (event) => {
          terminal.write(event.payload);
        },
      );

      const instance: TerminalInstance = {
        terminal,
        fitAddon,
        unlisten,
        onDataDispose,
        onResizeDispose,
        containerEl: container,
      };

      instancesRef.current.set(projectId, instance);
    },
    [],
  );

  const destroyInstance = useCallback((projectId: string) => {
    const instance = instancesRef.current.get(projectId);
    if (!instance) return;

    instance.unlisten?.();
    instance.onDataDispose?.dispose();
    instance.onResizeDispose?.dispose();
    instance.terminal.dispose();
    instancesRef.current.delete(projectId);
  }, []);

  const fitInstance = useCallback((projectId: string) => {
    const instance = instancesRef.current.get(projectId);
    if (instance) {
      try {
        instance.fitAddon.fit();
      } catch {
        // Terminal may not be ready
      }
    }
  }, []);

  const hasInstance = useCallback((projectId: string) => {
    return instancesRef.current.has(projectId);
  }, []);

  // Cleanup all on unmount
  useEffect(() => {
    return () => {
      for (const [, instance] of instancesRef.current) {
        instance.unlisten?.();
        instance.onDataDispose?.dispose();
        instance.onResizeDispose?.dispose();
        instance.terminal.dispose();
      }
      instancesRef.current.clear();
    };
  }, []);

  return { createInstance, destroyInstance, fitInstance, hasInstance };
}
