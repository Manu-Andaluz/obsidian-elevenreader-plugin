import assert from "node:assert/strict";
import test from "node:test";
import { narrationText } from "./note-text.ts";
import { estimatedSpans, spanAtTime, spokenBounds, wordSpans } from "./spoken.ts";

test("locates the spoken body after frontmatter", () => {
  const markdown = "---\ntitle: Dummy\n---\n\nHello there.";
  const bounds = spokenBounds(markdown);
  assert.equal(bounds?.text, narrationText(markdown));
  assert.equal(markdown.slice(bounds!.start, bounds!.start + bounds!.text.length), "Hello there.");
});

test("builds word timing from character alignment", () => {
  const text = "Hello there";
  const characters = [...text];
  const starts = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const ends = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1];
  const spans = wordSpans(text, characters, starts, ends);
  assert.deepEqual(spans, [
    { from: 0, to: 5, start: 0, end: 0.5 },
    { from: 6, to: 11, start: 0.6, end: 1.1 },
  ]);
  assert.equal(wordSpans("Hello", ["H"], [0], [0.1]), null);
  assert.equal(spanAtTime(spans ?? [], 0.7)?.from, 6);
  assert.equal(spanAtTime(spans ?? [], 0.55)?.from, 0);
});

test("estimates a word when no alignment was stored", () => {
  const spans = estimatedSpans("One two", 4);
  assert.equal(spanAtTime(spans, 0.1)?.from, 0);
  assert.equal(spanAtTime(spans, 2.1)?.from, 4);
});
