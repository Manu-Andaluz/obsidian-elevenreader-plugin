import assert from "node:assert/strict";
import test from "node:test";
import { narrationText } from "./note-text.ts";

test("keeps a note that has no frontmatter", () => {
  assert.equal(narrationText("Hello there.\n"), "Hello there.");
});

test("drops leading frontmatter", () => {
  const markdown = "---\ntitle: Dummy\n---\n\nThe body stays.";
  assert.equal(narrationText(markdown), "The body stays.");
});

test("does not treat a later rule as frontmatter", () => {
  assert.equal(narrationText("Keep this\n---\nAnd this"), "Keep this\n---\nAnd this");
});
