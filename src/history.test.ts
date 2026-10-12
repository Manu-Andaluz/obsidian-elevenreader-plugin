import assert from "node:assert/strict";
import test from "node:test";
import {
  historyAudioUrl,
  isMissingAudio,
  narrationFingerprint,
  rememberGeneration,
  removeGeneration,
  retireGeneration,
  reusableMatches,
  sanitizeGenerations,
  type GenerationRecord,
} from "./history.ts";

const sample: GenerationRecord = {
  historyItemId: "hist-new",
  fingerprint: "a".repeat(64),
  createdAt: 20,
  reusable: true,
  spans: null,
};

test("fingerprint changes with text, voice, model, and format", async () => {
  const base = {
    text: "Hello",
    voiceId: "voice",
    modelId: "model",
    outputFormat: "mp3_44100_128",
  };
  const original = await narrationFingerprint(base);
  assert.equal(original, await narrationFingerprint(base));
  assert.notEqual(original, await narrationFingerprint({ ...base, text: "Hello!" }));
  assert.notEqual(original, await narrationFingerprint({ ...base, voiceId: "other" }));
  assert.notEqual(original, await narrationFingerprint({ ...base, modelId: "other" }));
  assert.notEqual(original, await narrationFingerprint({ ...base, outputFormat: "mp3_44100_64" }));
});

test("reuses the newest match and keeps older ones when a new generation is remembered", () => {
  const older: GenerationRecord = { ...sample, historyItemId: "hist-old", createdAt: 10 };
  const other: GenerationRecord = {
    ...sample,
    historyItemId: "hist-other",
    fingerprint: "b".repeat(64),
  };
  const retired: GenerationRecord = { ...sample, historyItemId: "hist-retired", reusable: false };

  assert.deepEqual(
    reusableMatches([older, retired, other, sample], sample.fingerprint).map((record) => record.historyItemId),
    ["hist-new", "hist-old"],
  );

  const remembered = rememberGeneration([older], sample);
  assert.deepEqual(remembered.map((record) => record.historyItemId), ["hist-old", "hist-new"]);
  assert.equal(JSON.stringify(remembered).includes("Hello"), false);

  const retiredRecords = retireGeneration(remembered, "hist-new");
  assert.equal(retiredRecords.length, 2);
  assert.equal(retiredRecords[1]?.reusable, false);
  assert.deepEqual(reusableMatches(retiredRecords, sample.fingerprint), [older]);
});

test("removes the current narration and leaves every other generation", () => {
  const older: GenerationRecord = { ...sample, historyItemId: "hist-old", createdAt: 10 };
  const other: GenerationRecord = {
    ...sample,
    historyItemId: "hist-other",
    fingerprint: "b".repeat(64),
  };
  const remaining = removeGeneration([older, sample, other], sample.historyItemId);
  assert.deepEqual(remaining.map((record) => record.historyItemId), ["hist-old", "hist-other"]);
  assert.deepEqual(reusableMatches(remaining, sample.fingerprint), [older]);
  assert.equal(reusableMatches(remaining, other.fingerprint)[0]?.historyItemId, "hist-other");
});

test("ignores records that did not come from a verified plugin generation", () => {
  assert.deepEqual(
    sanitizeGenerations([
      sample,
      { historyItemId: "nope", fingerprint: "short", createdAt: 1, reusable: true },
      { text: "a note created somewhere else", historyItemId: "foreign" },
    ]),
    [sample],
  );
});

test("builds the history audio URL and treats missing audio as gone", () => {
  assert.equal(
    historyAudioUrl("abc 1"),
    "https://api.elevenlabs.io/v1/history/abc%201/audio",
  );
  assert.equal(isMissingAudio(404), true);
  assert.equal(isMissingAudio(403), true);
  assert.equal(isMissingAudio(410), true);
  assert.equal(isMissingAudio(401), false);
  assert.equal(isMissingAudio(500), false);
});
