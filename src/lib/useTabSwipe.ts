import { useRef, type TouchEvent } from "react";

const MIN_DX = 64;
const MAX_SLOPE = 0.75; // |dy|/|dx| — steeper than this is treated as scroll

/**
 * Horizontal edge swipe on mobile content to switch bottom-nav tabs.
 * Ignores mostly-vertical gestures so list scrolling keeps working.
 */
export function useTabSwipe<T extends string>(opts: {
  enabled: boolean;
  tabs: readonly T[];
  active: T;
  onChange: (id: T) => void;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);

  const onTouchStart = (e: TouchEvent) => {
    if (!opts.enabled) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.("input, textarea, select, [data-no-tab-swipe]")) {
      start.current = null;
      return;
    }
    const touch = e.touches[0];
    if (!touch) return;
    start.current = { x: touch.clientX, y: touch.clientY };
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (!opts.enabled || !start.current) return;
    const touch = e.changedTouches[0];
    const origin = start.current;
    start.current = null;
    if (!touch) return;

    const dx = touch.clientX - origin.x;
    const dy = touch.clientY - origin.y;
    if (Math.abs(dx) < MIN_DX) return;
    if (Math.abs(dy) > Math.abs(dx) * MAX_SLOPE) return;

    const idx = opts.tabs.indexOf(opts.active);
    if (idx < 0) return;

    if (dx < 0 && idx < opts.tabs.length - 1) {
      opts.onChange(opts.tabs[idx + 1]!);
    } else if (dx > 0 && idx > 0) {
      opts.onChange(opts.tabs[idx - 1]!);
    }
  };

  const onTouchCancel = () => {
    start.current = null;
  };

  return { onTouchStart, onTouchEnd, onTouchCancel };
}
