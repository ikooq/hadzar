import type { Couple, DayEvent } from "./types";

export type RankedWindow = {
  start: number;
  end: number;
  score: number;
  label: "Best chance" | "Good chance" | "Short opening";
  reason: string;
};

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

function dayDistance(from: string, to: string) {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  return Math.abs(Math.round((a - b) / 86_400_000));
}

/**
 * Rank free windows by the chance that a couple can actually use them.
 * Longer windows matter, but a little breathing room around busy blocks and
 * a near-term day keep the result grounded in the couple's real rhythm.
 */
export function rankSharedWindows(
  windows: Array<{ start: number; end: number }>,
  events: DayEvent[],
  couple: Couple,
  day: string,
  referenceDay: string,
): RankedWindow[] {
  const busy = events
    .filter((event) => !event.shared)
    .map((event) => ({ start: event.start_min, end: event.end_min }))
    .sort((a, b) => a.start - b.start);
  const distance = dayDistance(day, referenceDay);
  return windows
    .map((window) => {
      const length = window.end - window.start;
      const before = busy.filter((event) => event.end <= window.start).at(-1);
      const after = busy.find((event) => event.start >= window.end);
      const leftRoom = before ? window.start - before.end : window.start - couple.day_start;
      const rightRoom = after ? after.start - window.end : couple.day_end - window.end;
      const breathingRoom = Math.max(0, Math.min(leftRoom, rightRoom));
      const score = Math.round(
        Math.min(52, length / 180 * 52)
          + Math.min(22, breathingRoom / 5)
          + Math.max(0, 20 - distance * 4)
          + (length >= 90 ? 6 : 0),
      );
      const label: RankedWindow["label"] = score >= 72 ? "Best chance" : score >= 48 ? "Good chance" : "Short opening";
      const reason = `${length >= 60 ? `${Math.floor(length / 60)}${length % 60 ? `h ${length % 60}m` : "h"}` : `${length}m`} free · ${breathingRoom}m breathing room`;
      return { ...window, score, label, reason };
    })
    .sort((a, b) => b.score - a.score || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
}
