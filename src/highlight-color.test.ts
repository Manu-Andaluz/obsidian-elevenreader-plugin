import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_HIGHLIGHT_COLOR, normalizeHighlightColor } from "./highlight-color.ts";

test("keeps a chosen highlight color and falls back when it is not a color", () => {
  assert.equal(normalizeHighlightColor("#A1B2C3"), "#a1b2c3");
  assert.equal(normalizeHighlightColor(DEFAULT_HIGHLIGHT_COLOR), DEFAULT_HIGHLIGHT_COLOR);
  assert.equal(normalizeHighlightColor("accent"), DEFAULT_HIGHLIGHT_COLOR);
  assert.equal(normalizeHighlightColor("#fff"), DEFAULT_HIGHLIGHT_COLOR);
  assert.equal(normalizeHighlightColor(undefined), DEFAULT_HIGHLIGHT_COLOR);
});
