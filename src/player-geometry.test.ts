import assert from "node:assert/strict";
import test from "node:test";
import { clampPosition, formatClock, normalizeSkipSeconds, skipTo } from "./player-geometry.ts";

test("formats playback time", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(5), "0:05");
  assert.equal(formatClock(65), "1:05");
  assert.equal(formatClock(3661), "1:01:01");
  assert.equal(formatClock(Number.NaN), "0:00");
});

test("skips by the interval and stops at the ends", () => {
  assert.equal(skipTo(20, 90, -10), 10);
  assert.equal(skipTo(20, 90, 10), 30);
  assert.equal(skipTo(3, 90, -10), 0);
  assert.equal(skipTo(85, 90, 10), 90);
  assert.equal(skipTo(Number.NaN, 90, 10), 10);
  assert.equal(skipTo(20, 0, 10), 0);
});

test("accepts only the skip choices", () => {
  assert.equal(normalizeSkipSeconds(5), 5);
  assert.equal(normalizeSkipSeconds(10), 10);
  assert.equal(normalizeSkipSeconds(15), 15);
  assert.equal(normalizeSkipSeconds(7), 10);
  assert.equal(normalizeSkipSeconds(undefined), 10);
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
