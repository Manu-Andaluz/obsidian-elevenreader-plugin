import assert from "node:assert/strict";
import test from "node:test";
import { locatePreviewSpan, textNodeSpan, visibleCandidates } from "./preview-highlight.ts";

test("reads the visible word out of markdown tokens", () => {
  assert.deepEqual(visibleCandidates("**bold**"), ["**bold**", "bold"]);
  assert.deepEqual(visibleCandidates("[note](https://example.com)"), ["[note](https://example.com)", "note"]);
  assert.deepEqual(visibleCandidates("[[Page|alias]]"), ["[[Page|alias]]", "alias"]);
  assert.deepEqual(visibleCandidates("`code`"), ["`code`", "code"]);
});

test("highlights the occurrence nearest the spoken position", () => {
  const preview = "note note note";
  assert.deepEqual(locatePreviewSpan(preview, "note", 0, 20), { start: 0, end: 4 });
  assert.deepEqual(locatePreviewSpan(preview, "note", 18, 20), { start: 10, end: 14 });
  assert.deepEqual(locatePreviewSpan(preview, "**note**", 18, 20), { start: 10, end: 14 });
  assert.equal(locatePreviewSpan(preview, "missing", 0, 20), null);
});

test("maps a preview offset onto text nodes", () => {
  assert.deepEqual(textNodeSpan([4, 1, 4], 5, 9), {
    startNode: 2,
    startOffset: 0,
    endNode: 2,
    endOffset: 4,
  });
  assert.deepEqual(textNodeSpan([3, 3], 2, 5), {
    startNode: 0,
    startOffset: 2,
    endNode: 1,
    endOffset: 2,
  });
  assert.equal(textNodeSpan([2], 0, 3), null);
});
