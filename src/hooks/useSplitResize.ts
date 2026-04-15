import { useState, useCallback, useRef, useEffect } from "react";

interface UseSplitResizeOptions {
  /** Minimum percentage each pane can be (default 25) */
  minPercent?: number;
  /** Initial left pane percentage (default 50) */
  initialPercent?: number;
  /** Called after drag ends so terminals can refit */
  onResizeEnd?: () => void;
}

interface UseSplitResizeReturn {
  leftPercent: number;
  isDragging: boolean;
  handleMouseDown: (e: React.MouseEvent) => void;
  containerRef: React.RefObject<HTMLDivElement>;
}

/**
 * Hook for managing a draggable vertical split divider.
 * Returns percentage-based widths and drag handlers.
 */
export function useSplitResize(
  options: UseSplitResizeOptions = {},
): UseSplitResizeReturn {
  const { minPercent = 25, initialPercent = 50, onResizeEnd } = options;

  const [leftPercent, setLeftPercent] = useState(initialPercent);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null!);
  const onResizeEndRef = useRef(onResizeEnd);

  // Keep callback ref current without re-registering listeners
  useEffect(() => {
    onResizeEndRef.current = onResizeEnd;
  }, [onResizeEnd]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);

      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();

      function onMouseMove(ev: MouseEvent) {
        if (!container) return;
        const x = ev.clientX - rect.left;
        let pct = (x / rect.width) * 100;
        pct = Math.max(minPercent, Math.min(100 - minPercent, pct));
        setLeftPercent(pct);
      }

      function onMouseUp() {
        setIsDragging(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        onResizeEndRef.current?.();
      }

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [minPercent],
  );

  return { leftPercent, isDragging, handleMouseDown, containerRef };
}
