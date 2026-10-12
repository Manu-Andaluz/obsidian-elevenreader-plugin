import assert from "node:assert/strict";
import test from "node:test";
import { clampPosition, formatClock } from "./player-geometry.ts";

test("formats playback time", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(5), "0:05");
  assert.equal(formatClock(65), "1:05");
  assert.equal(formatClock(3661), "1:01:01");
  assert.equal(formatClock(Number.NaN), "0:00");
});

test("keeps the player inside the window", () => {
  assert.deepEqual(clampPosition(-40, 900, 120, 32, 800, 600), {
    left: 8,
    top: 560,
  });
  assert.deepEqual(clampPosition(100, 40, 120, 32, 800, 600), {
    left: 100,
    top: 40,
  });
});
