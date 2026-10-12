import assert from "node:assert/strict";
import test from "node:test";
import { READER_ACTIONS } from "./actions.ts";

test("lists the reader commands and leaves playback off the surface", () => {
  assert.deepEqual(
    READER_ACTIONS.map((action) => action.name),
    [
      "Narrate current note",
      "Narrate selected text",
      "Open player",
      "Stop narration",
      "Remove saved narration",
      "Export audio",
    ],
  );
  assert.equal(READER_ACTIONS.some((action) => /skip|seek|pause/i.test(action.name)), false);
});
