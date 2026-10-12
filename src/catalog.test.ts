import assert from "node:assert/strict";
import test from "node:test";
import {
  choiceLabels,
  ensureChoice,
  loadVoiceCatalog,
  parseSpeechModels,
  voicesPageUrl,
} from "./catalog.ts";

test("asks for premade and account voices, one page at a time", () => {
  assert.equal(
    voicesPageUrl("default", null),
    "https://api.elevenlabs.io/v2/voices?page_size=100&voice_type=default&include_total_count=false",
  );
  assert.match(voicesPageUrl("non-community", "next"), /next_page_token=next/);
});

test("keeps speech models and walks every voice page", async () => {
  const models = parseSpeechModels(
    JSON.stringify([
      { model_id: "eleven_multilingual_v2", name: "Multilingual v2", can_do_text_to_speech: true },
      { model_id: "scribe", name: "Scribe", can_do_text_to_speech: false },
    ]),
  );
  assert.deepEqual(models, [{ id: "eleven_multilingual_v2", name: "Multilingual v2" }]);

  const pages: Record<string, string> = {
    [voicesPageUrl("default", null)]: JSON.stringify({
      voices: [{ voice_id: "george", name: "George" }],
      has_more: true,
      next_page_token: "p2",
    }),
    [voicesPageUrl("default", "p2")]: JSON.stringify({
      voices: [{ voice_id: "sarah", name: "Sarah" }],
      has_more: false,
      next_page_token: null,
    }),
    [voicesPageUrl("non-community", null)]: JSON.stringify({
      voices: [
        { voice_id: "sarah", name: "Sarah" },
        { voice_id: "mine", name: "Mine" },
      ],
      has_more: false,
    }),
  };

  const voices = await loadVoiceCatalog(async (url) => {
    const body = pages[url];
    if (!body) throw new Error(`unexpected ${url}`);
    return body;
  });

  assert.deepEqual(voices, [
    { id: "george", name: "George" },
    { id: "mine", name: "Mine" },
    { id: "sarah", name: "Sarah" },
  ]);
});

test("keeps a saved choice that is missing from the list", () => {
  const choices = ensureChoice([{ id: "george", name: "George" }], "legacy");
  assert.deepEqual(choiceLabels(choices), {
    george: "George",
    legacy: "legacy",
  });
});

test("disambiguates voices that share a name", () => {
  assert.deepEqual(
    choiceLabels([
      { id: "aaaaaa111", name: "George" },
      { id: "bbbbbb222", name: "George" },
    ]),
    {
      aaaaaa111: "George (aaaaaa)",
      bbbbbb222: "George (bbbbbb)",
    },
  );
});
