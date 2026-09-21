import assert from "node:assert/strict";
import ts from "typescript";
import { readFile } from "node:fs/promises";
const source = await readFile(
  new URL("../lib/schedule.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { sharedWindows, rankSharedWindows } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);
const c = { day_start: 480, day_end: 1320, minimum_window: 30, buffer: 0 };
assert.deepEqual(sharedWindows([], c), [{ start: 480, end: 1320 }]);
assert.deepEqual(
  sharedWindows(
    [
      { start_min: 480, end_min: 810 },
      { start_min: 600, end_min: 800 },
      { start_min: 900, end_min: 1320 },
    ],
    c,
  ),
  [{ start: 810, end: 900 }],
);
assert.deepEqual(
  sharedWindows(
    [
      { start_min: 480, end_min: 810 },
      { start_min: 900, end_min: 1320 },
    ],
    { ...c, buffer: 15 },
  ),
  [{ start: 825, end: 885 }],
);
assert.deepEqual(
  sharedWindows(
    [
      { start_min: 400, end_min: 840 },
      { start_min: 860, end_min: 1400 },
    ],
    c,
  ),
  [],
);
assert.deepEqual(
  sharedWindows(
    [
      { start_min: 0, end_min: 400 },
      { start_min: 1400, end_min: 1440 },
    ],
    c,
  ),
  [{ start: 480, end: 1320 }],
);
assert.deepEqual(sharedWindows([{ start_min: 480, end_min: 1320 }], c), []);
const ranked = rankSharedWindows(
  [{ start: 540, end: 600 }, { start: 720, end: 900 }],
  [{ start_min: 600, end_min: 690 }],
  c,
  "2026-09-21",
  "2026-09-21",
);
assert.equal(ranked[0].start, 720);
assert.equal(ranked[0].label, "Best chance");
assert.match(ranked[0].reason, /breathing room/);
console.log(
  "PASS: empty schedules, overlapping busy intervals, buffers, minimum duration, clipping, ranking and full-day busy.",
);
