import assert from "node:assert/strict";
import test from "node:test";
import {
  messageFromElevenLabs,
  alignedSpeechUrl,
  parseAlignedSpeech,
  requestSpeech,
  speechUrl,
  type SpeechTransport,
} from "./speech.ts";

const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00]).buffer;

test("builds the convert endpoint for a voice", () => {
  assert.equal(
    speechUrl("JBFqnCBsd6RMkjVDRZzb"),
    "https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_44100_128",
  );
});

test("posts the note text and returns audio bytes", async () => {
  let seenUrl = "";
  let seenBody = "";
  let seenKey = "";
  const transport: SpeechTransport = {
    async post(url, body, headers) {
      seenUrl = url;
      seenBody = body;
      seenKey = headers["xi-api-key"] ?? "";
      return {
        status: 200,
        headers: { "History-Item-Id": "hist-1" },
        async arrayBuffer() {
          return mp3;
        },
        async text() {
          return "";
        },
      };
    },
  };

  const audio = await requestSpeech(
    {
      apiKey: "secret",
      voiceId: "voice",
      modelId: "eleven_multilingual_v2",
      text: "Hello",
    },
    transport,
  );

  assert.equal(seenUrl, speechUrl("voice"));
  assert.deepEqual(JSON.parse(seenBody), {
    text: "Hello",
    model_id: "eleven_multilingual_v2",
  });
  assert.equal(seenKey, "secret");
  assert.equal(audio.audio.byteLength, 4);
  assert.equal(audio.historyItemId, "hist-1");
});

test("surfaces an API key rejection", async () => {
  const transport: SpeechTransport = {
    async post() {
      return {
        status: 401,
        headers: {},
        async arrayBuffer() {
          return new ArrayBuffer(0);
        },
        async text() {
          return JSON.stringify({
            detail: { message: "Invalid API key" },
          });
        },
      };
    },
  };

  await assert.rejects(
    () =>
      requestSpeech(
        {
          apiKey: "nope",
          voiceId: "voice",
          modelId: "eleven_multilingual_v2",
          text: "Hello",
        },
        transport,
      ),
    /Invalid API key/,
  );
});

test("reads validation messages", () => {
  const body = JSON.stringify({
    detail: [{ msg: "voice_id is invalid" }],
  });
  assert.equal(messageFromElevenLabs(422, body), "voice_id is invalid");
});

test("passes the abort signal through", async () => {
  const controller = new AbortController();
  let seen: AbortSignal | undefined;
  const transport: SpeechTransport = {
    async post(_url, _body, _headers, signal) {
      seen = signal;
      return {
        status: 200,
        headers: {},
        async arrayBuffer() {
          return mp3;
        },
        async text() {
          return "";
        },
      };
    },
  };

  await requestSpeech(
    {
      apiKey: "secret",
      voiceId: "voice",
      modelId: "model",
      text: "Hello",
      signal: controller.signal,
    },
    transport,
  );

  assert.equal(seen, controller.signal);
});

test("reads character timing from the speech response", () => {
  assert.equal(
    alignedSpeechUrl("voice"),
    "https://api.elevenlabs.io/v1/text-to-speech/voice/with-timestamps?output_format=mp3_44100_128",
  );
  const parsed = parseAlignedSpeech(
    JSON.stringify({
      audio_base64: "abc",
      alignment: {
        characters: ["H", "i"],
        character_start_times_seconds: [0, 0.2],
        character_end_times_seconds: [0.2, 0.4],
      },
    }),
  );
  assert.equal(parsed.audioBase64, "abc");
  assert.deepEqual(parsed.characters, ["H", "i"]);
  assert.deepEqual(parsed.starts, [0, 0.2]);
  assert.deepEqual(parsed.ends, [0.2, 0.4]);
});
