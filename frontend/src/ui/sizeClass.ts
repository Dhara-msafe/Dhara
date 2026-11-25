/**
 * Phone size classes (redesign v3). Pure — no react-native import — so it
 * runs under node:test; the hook lives in useSizeClass.ts.
 *
 * Android's own classes put every phone in one group ("compact" = width
 * under 600), which is too coarse here, so phones get three steps. The
 * "regular" row is the approved prototype's own values (drawn 396 wide).
 * Spacing and titles change by class; body text stays 14 on every phone.
 */
export type WidthClass = 'small' | 'regular' | 'large' | 'tablet';

export type SizeClass = {
  width: WidthClass;
  /** Window under 700 tall: headers use one row, optional blocks collapse. */
  short: boolean;
  /** Left/right screen padding. */
  margin: number;
  /** Gap between cards and sections. */
  gap: number;
  /** Screen title size. */
  title: number;
  /** Main button minimum height (never under the 48 tap target). */
  button: number;
  /** Help tiles per row. */
  tileColumns: number;
  /** Choice cards per row (e.g. Walk / Auto / Bus). */
  choiceColumns: number;
  /** Max content width; content is centred beyond it. */
  maxContentWidth: number;
};

export const SIZE_BREAKS = { regular: 360, large: 412, tablet: 600, shortHeight: 700 } as const;

export function widthClassFor(width: number): WidthClass {
  if (!(width > 0)) return 'regular';
  if (width >= SIZE_BREAKS.tablet) return 'tablet';
  if (width >= SIZE_BREAKS.large) return 'large';
  if (width >= SIZE_BREAKS.regular) return 'regular';
  return 'small';
}

const TABLE: Record<WidthClass, Omit<SizeClass, 'width' | 'short'>> = {
  small:   { margin: 12, gap: 10, title: 21, button: 48, tileColumns: 2, choiceColumns: 2, maxContentWidth: 600 },
  regular: { margin: 16, gap: 12, title: 24, button: 50, tileColumns: 2, choiceColumns: 3, maxContentWidth: 600 },
  large:   { margin: 18, gap: 12, title: 24, button: 52, tileColumns: 2, choiceColumns: 3, maxContentWidth: 600 },
  tablet:  { margin: 24, gap: 14, title: 26, button: 52, tileColumns: 4, choiceColumns: 3, maxContentWidth: 640 },
};

export function sizeClassFor(width: number, height: number): SizeClass {
  const w = widthClassFor(width);
  return { width: w, short: height > 0 && height < SIZE_BREAKS.shortHeight, ...TABLE[w] };
}

/** Width of one cell in an n-column grid inside the screen margins. */
export function columnWidth(available: number, columns: number, gap: number): number {
  const n = Math.max(1, Math.floor(columns));
  return Math.max(0, Math.floor((available - gap * (n - 1)) / n));
}

/**
 * Caps for the phone's font-size setting (maxFontSizeMultiplier): body text
 * may grow to 1.3x, titles/buttons/tab labels to 1.15x, so large-text users
 * get larger text without layouts breaking.
 */
export const FONT_SCALE_CAP = { body: 1.3, chrome: 1.15 } as const;
