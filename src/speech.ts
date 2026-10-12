export interface SpeechRequest {
  apiKey: string;
  voiceId: string;
  modelId: string;
  text: string;
  signal?: AbortSignal;
}

export interface SpeechResponse {
  status: number;
  headers: Record<string, string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

export interface SpeechResult {
  audio: ArrayBuffer;
  historyItemId: string | null;
}

export const OUTPUT_FORMAT = "mp3_44100_128";

export interface SpeechTransport {
  post(
    url: string,
    body: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<SpeechResponse>;
}

export class SpeechRequestError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "SpeechRequestError";
    this.status = status;
  }
}

export function speechUrl(voiceId: string): string {
  return `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${OUTPUT_FORMAT}`;
}

export function historyItemIdFromHeaders(headers: Record<string, string>): string | null {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "history-item-id" && value.trim()) return value.trim();
  }
  return null;
}

export function alignedSpeechUrl(voiceId: string): string {
  return `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${OUTPUT_FORMAT}`;
}

export interface AlignedSpeech {
  audioBase64: string;
  historyItemId: string | null;
  characters: string[];
  starts: number[];
  ends: number[];
}

export function parseAlignedSpeech(body: string): Omit<AlignedSpeech, "historyItemId"> {
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object") {
    throw new SpeechRequestError("ElevenLabs returned an unreadable narration.");
  }
  const record = parsed as {
    audio_base64?: unknown;
    alignment?: unknown;
  };
  if (typeof record.audio_base64 !== "string" || !record.audio_base64) {
    throw new SpeechRequestError("ElevenLabs returned no audio.");
  }
  const alignment = readAlignment(record.alignment);
  return {
    audioBase64: record.audio_base64,
    characters: alignment.characters,
    starts: alignment.starts,
    ends: alignment.ends,
  };
}

export async function requestAlignedSpeech(
  request: SpeechRequest,
  transport: SpeechTransport,
): Promise<AlignedSpeech> {
  const voiceId = request.voiceId.trim();
  const modelId = request.modelId.trim();
  if (!voiceId) {
    throw new SpeechRequestError("Set an ElevenLabs voice ID in settings.");
  }
  if (!modelId) {
    throw new SpeechRequestError("Set an ElevenLabs model ID in settings.");
  }

  const response = await transport.post(
    alignedSpeechUrl(voiceId),
    JSON.stringify({ text: request.text, model_id: modelId }),
    {
      "xi-api-key": request.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    request.signal,
  );

  if (response.status < 200 || response.status >= 300) {
    throw new SpeechRequestError(
      messageFromElevenLabs(response.status, await response.text()),
      response.status,
    );
  }

  return {
    ...parseAlignedSpeech(await response.text()),
    historyItemId: historyItemIdFromHeaders(response.headers),
  };
}

function readAlignment(value: unknown): { characters: string[]; starts: number[]; ends: number[] } {
  if (!value || typeof value !== "object") return { characters: [], starts: [], ends: [] };
  const alignment = value as {
    characters?: unknown;
    character_start_times_seconds?: unknown;
    character_end_times_seconds?: unknown;
  };
  return {
    characters: stringList(alignment.characters),
    starts: numberList(alignment.character_start_times_seconds),
    ends: numberList(alignment.character_end_times_seconds),
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return [];
  return value;
}

function numberList(value: unknown): number[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "number" && Number.isFinite(item))) {
    return [];
  }
  return value;
}

export function messageFromElevenLabs(status: number, body: string): string {
  const detail = readDetail(body);
  if (status === 401) {
    return detail ?? "ElevenLabs rejected the API key.";
  }
  if (status === 429) {
    return detail ?? "ElevenLabs rate limit reached. Wait and try again.";
  }
  if (detail) return detail;
  return `ElevenLabs returned ${status}.`;
}

export async function requestSpeech(
  request: SpeechRequest,
  transport: SpeechTransport,
): Promise<SpeechResult> {
  const voiceId = request.voiceId.trim();
  const modelId = request.modelId.trim();
  if (!voiceId) {
    throw new SpeechRequestError("Set an ElevenLabs voice ID in settings.");
  }
  if (!modelId) {
    throw new SpeechRequestError("Set an ElevenLabs model ID in settings.");
  }

  const response = await transport.post(
    speechUrl(voiceId),
    JSON.stringify({ text: request.text, model_id: modelId }),
    {
      "xi-api-key": request.apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    request.signal,
  );

  if (response.status < 200 || response.status >= 300) {
    throw new SpeechRequestError(
      messageFromElevenLabs(response.status, await response.text()),
      response.status,
    );
  }

  return {
    audio: await response.arrayBuffer(),
    historyItemId: historyItemIdFromHeaders(response.headers),
  };
}

function readDetail(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object") return undefined;
    const detail = (parsed as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail.trim();
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      const message = (detail as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
    if (Array.isArray(detail)) {
      const messages = detail
        .map((item) => {
          if (!item || typeof item !== "object") return "";
          const message = (item as { msg?: unknown }).msg;
          return typeof message === "string" ? message.trim() : "";
        })
        .filter(Boolean);
      if (messages.length > 0) return messages.join(" ");
    }
  } catch {
    const trimmed = body.trim();
    if (trimmed && !trimmed.startsWith("<")) return trimmed.slice(0, 240);
  }
  return undefined;
}
