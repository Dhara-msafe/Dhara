/**
 * Position maths for the draggable issue-reporter button.
 *
 * Pure functions only — no React, no React Native — so the drag/tap threshold,
 * the bounds clamping and the stored-position parsing can be tested directly:
 *
 *   cd /app/frontend && node --experimental-strip-types \
 *     --import ./src/voice/core/__tests__/ts-resolve.mjs \
 *     --test src/components/__tests__/fabPosition.test.ts
 */

export type Point = { x: number; y: number };
export type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

export const FAB_SIZE = 44;          // visual size; the touch target is larger via hitSlop
export const EDGE_MARGIN = 16;       // inset kept from the left/right edge when snapped
export const TAP_SLOP = 7;           // movement under this is a tap, not a drag
export const RESET_LONG_PRESS_MS = 600;

/** Gap kept free at the bottom so the button can never sit on the tab bar. */
export const BOTTOM_RESERVED = 72;
/** Where the button starts: bottom-right, stacked above the Help FAB. */
export const DEFAULT_BOTTOM_OFFSET = 196;
/** Gap kept free at the top so the button can never sit on the status bar. */
export const TOP_RESERVED = 8;

export const POSITION_KEY = 'issue_reporter_fab_position_v1';

export function computeBounds(
  width: number,
  height: number,
  insets: { top: number; bottom: number; left: number; right: number },
  size: number = FAB_SIZE,
): Bounds {
  const minX = insets.left + EDGE_MARGIN;
  const minY = insets.top + TOP_RESERVED;
  const maxX = Math.max(minX, width - insets.right - EDGE_MARGIN - size);
  const maxY = Math.max(minY, height - insets.bottom - BOTTOM_RESERVED - size);
  return { minX, maxX, minY, maxY };
}

// NOTE: clampToBounds, snapToEdge and isTap carry a 'worklet' directive so
// Reanimated can run them directly on the UI thread inside the pan-gesture
// callbacks (onUpdate/onEnd), as well as normally from JS (accessibility
// nudges, the initial-position restore effect). A 'worklet' function is a
// strict superset of a normal one — nothing changes for JS-thread callers.
export function clampToBounds(p: Point, b: Bounds): Point {
  'worklet';
  return {
    x: Math.min(Math.max(p.x, b.minX), b.maxX),
    y: Math.min(Math.max(p.y, b.minY), b.maxY),
  };
}

/** After a drag, settle against whichever side edge is closer. */
export function snapToEdge(p: Point, b: Bounds): Point {
  'worklet';
  const clamped = clampToBounds(p, b);
  const centre = (b.minX + b.maxX) / 2;
  return { x: clamped.x <= centre ? b.minX : b.maxX, y: clamped.y };
}

/** A gesture that moved less than the slop in both axes opens the sheet. */
export function isTap(dx: number, dy: number, slop: number = TAP_SLOP): boolean {
  'worklet';
  return Math.abs(dx) < slop && Math.abs(dy) < slop;
}

export function defaultPosition(
  width: number,
  height: number,
  insets: { top: number; bottom: number; left: number; right: number },
  size: number = FAB_SIZE,
): Point {
  const b = computeBounds(width, height, insets, size);
  return clampToBounds(
    { x: b.maxX, y: height - insets.bottom - DEFAULT_BOTTOM_OFFSET - size },
    b,
  );
}

/** Tolerant of anything previously written to storage, including junk. */
export function parseStoredPosition(raw: string | null): Point | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number' &&
      Number.isFinite(parsed.x) && Number.isFinite(parsed.y)
    ) {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {}
  return null;
}
