import type { Couple, DayEvent } from "./types";
export function sharedWindows(events: DayEvent[], couple: Couple) {
  const busy = events
    .map((e) => [
      Math.max(couple.day_start, e.start_min - couple.buffer),
      Math.min(couple.day_end, e.end_min + couple.buffer),
    ])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const free: { start: number; end: number }[] = [];
  let cursor = couple.day_start;
  for (const [start, end] of busy) {
    if (start - cursor >= couple.minimum_window)
      free.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  }
  if (couple.day_end - cursor >= couple.minimum_window)
    free.push({ start: cursor, end: couple.day_end });
  return free;
}
