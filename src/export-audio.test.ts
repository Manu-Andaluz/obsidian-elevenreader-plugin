import assert from "node:assert/strict";
import test from "node:test";
import { audioFromHistory, exportBaseName, exportPath, normalizeExportFolder, saveExport } from "./export-audio.ts";
import { removeGeneration, type GenerationRecord } from "./history.ts";
import { SpeechRequestError } from "./speech.ts";

const record: GenerationRecord = {
  historyItemId: "hist-1",
  fingerprint: "a".repeat(64),
  createdAt: 1,
  reusable: true,
  spans: null,
};

test("keeps the vault-root audios folder and refuses paths that leave the vault", () => {
  assert.equal(normalizeExportFolder(undefined), "audios");
  assert.equal(normalizeExportFolder("  audios/ "), "audios");
  assert.equal(normalizeExportFolder("Notes/Audio"), "Notes/Audio");
  assert.equal(normalizeExportFolder("../../../audios"), "audios");
  assert.equal(normalizeExportFolder("../secret"), "audios");
  assert.equal(normalizeExportFolder(""), "audios");
});

test("builds a safe filename and does not overwrite an existing export", async () => {
  assert.equal(exportBaseName('Chapter 1: "Hello"?'), "Chapter 1 Hello");
  assert.equal(exportBaseName("   "), "narration");
  assert.equal(exportPath("audios", "Note", 1), "audios/Note.mp3");
  assert.equal(exportPath("audios", "Note", 2), "audios/Note 2.mp3");

  const files = new Map<string, ArrayBuffer>();
  const store = memoryFiles(files);
  const first = new Uint8Array([1, 2, 3]).buffer;
  const second = new Uint8Array([4, 5]).buffer;
  assert.equal(await saveExport(store, "audios", "Dummy note", first), "audios/Dummy note.mp3");
  assert.equal(await saveExport(store, "audios", "Dummy note", second), "audios/Dummy note 2.mp3");
  assert.equal(files.get("audios/Dummy note.mp3")?.byteLength, 3);
  assert.equal(files.get("audios/Dummy note 2.mp3")?.byteLength, 2);
  assert.equal(files.has("audios"), true);
});

test("creates the destination folder and skips a missing history item", async () => {
  const files = new Map<string, ArrayBuffer>();
  const audio = new Uint8Array([7]).buffer;
  const path = await saveExport(memoryFiles(files), "Notes/Audio", "Dummy", audio);
  assert.equal(path, "Notes/Audio/Dummy.mp3");
  assert.equal(files.has("Notes"), true);
  assert.equal(files.has("Notes/Audio"), true);

  const older: GenerationRecord = { ...record, historyItemId: "hist-old", createdAt: 0 };
  const calls: string[] = [];
  const saved = await audioFromHistory([record, older], async (historyItemId) => {
    calls.push(historyItemId);
    if (historyItemId === "hist-1") throw new SpeechRequestError("gone", 404);
    return audio;
  });
  assert.deepEqual(calls, ["hist-1", "hist-old"]);
  assert.deepEqual(saved, { audio, historyItemId: "hist-old" });
});

test("downloads an existing history item and does not invent a generation", async () => {
  const calls: string[] = [];
  const audio = new Uint8Array([9]).buffer;
  const saved = await audioFromHistory([record], async (historyItemId) => {
    calls.push(historyItemId);
    return audio;
  });
  assert.deepEqual(saved, { audio, historyItemId: "hist-1" });
  assert.deepEqual(calls, ["hist-1"]);
});

test("reports a missing history item and leaves an exported file when the record is removed", async () => {
  const files = new Map<string, ArrayBuffer>([["audios/Dummy note.mp3", new Uint8Array([1]).buffer]]);
  const missing = await audioFromHistory([record], async () => {
    throw new SpeechRequestError("gone", 404);
  });
  assert.deepEqual(missing, { missingIds: ["hist-1"] });

  const remaining = removeGeneration([record], record.historyItemId);
  assert.deepEqual(remaining, []);
  assert.equal(files.has("audios/Dummy note.mp3"), true);
});

test("passes network errors through without a replacement generation", async () => {
  await assert.rejects(
    () => audioFromHistory([record], async () => {
      throw new SpeechRequestError("ElevenLabs returned 500.", 500);
    }),
    (error: unknown) => error instanceof SpeechRequestError && error.status === 500,
  );
});

function memoryFiles(files: Map<string, ArrayBuffer>) {
  return {
    async exists(path: string) {
      return files.has(path);
    },
    async mkdir(path: string) {
      files.set(path, new ArrayBuffer(0));
    },
    async write(path: string, data: ArrayBuffer) {
      if (files.has(path) && files.get(path)?.byteLength) {
        throw new Error(`overwrite ${path}`);
      }
      files.set(path, data);
    },
  };
}
