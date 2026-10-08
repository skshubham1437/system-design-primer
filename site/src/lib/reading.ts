// When does reading a page count as "read"? Scrolling to the bottom is not enough.

/** Share of the estimated reading time that must pass before a page counts as read. */
export const READ_FRACTION = 0.4;
/** Even a very short page needs this long, so a click-through never counts. */
export const MIN_READ_MS = 8_000;

export function requiredMs(minutes: number): number {
  return Math.max(MIN_READ_MS, READ_FRACTION * Math.max(1, minutes) * 60_000);
}

/** `visibleMs` counts only time the tab was visible. */
export function shouldMarkRead(o: { endSeen: boolean; visibleMs: number; minutes: number }): boolean {
  return o.endSeen && o.visibleMs >= requiredMs(o.minutes);
}

/** Partial progress shown as a half-filled dot: how far down the page the reader has been, 0..99 until the page counts as read. */
export function partialPct(scrolledFraction: number): number {
  return Math.min(99, Math.max(0, Math.round(scrolledFraction * 100)));
}
