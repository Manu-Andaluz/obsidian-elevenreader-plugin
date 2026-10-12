import { sanitizeSpans, type SpokenSpan } from "./spoken.ts";

export interface GenerationRecord {
  historyItemId: string;
  fingerprint: string;
  createdAt: number;
  reusable: boolean;
  spans: SpokenSpan[] | null;
}

export async function narrationFingerprint(input: {
  text: string;
  voiceId: string;
  modelId: string;
  outputFormat: string;
}): Promise<string> {
  const material = [
    input.outputFormat.trim(),
    input.voiceId.trim(),
    input.modelId.trim(),
    input.text,
  ].join("\0");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function historyAudioUrl(historyItemId: string): string {
  return `https://api.elevenlabs.io/v1/history/${encodeURIComponent(historyItemId)}/audio`;
}

export function isMissingAudio(status: number | undefined): boolean {
  return status === 403 || status === 404 || status === 410;
}

export function reusableMatches(
  records: GenerationRecord[],
  fingerprint: string,
): GenerationRecord[] {
  return records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.reusable && record.fingerprint === fingerprint)
    .sort((a, b) => b.record.createdAt - a.record.createdAt || b.index - a.index)
    .map(({ record }) => record);
}

export function rememberGeneration(
  records: GenerationRecord[],
  record: GenerationRecord,
): GenerationRecord[] {
  if (records.some((existing) => existing.historyItemId === record.historyItemId)) return records;
  return [...records, record];
}

export function removeGeneration(
  records: GenerationRecord[],
  historyItemId: string,
): GenerationRecord[] {
  return records.filter((record) => record.historyItemId !== historyItemId);
}

export function retireGeneration(
  records: GenerationRecord[],
  historyItemId: string,
): GenerationRecord[] {
  return records.map((record) =>
    record.historyItemId === historyItemId ? { ...record, reusable: false } : record,
  );
}

export function sanitizeGenerations(value: unknown): GenerationRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(readRecord);
}

function readRecord(value: unknown): GenerationRecord[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Partial<GenerationRecord>;
  if (typeof record.historyItemId !== "string" || !record.historyItemId.trim()) return [];
  if (typeof record.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(record.fingerprint)) return [];
  if (typeof record.createdAt !== "number" || !Number.isFinite(record.createdAt)) return [];
  return [
    {
      historyItemId: record.historyItemId.trim(),
      fingerprint: record.fingerprint,
      createdAt: record.createdAt,
      reusable: record.reusable === true,
      spans: sanitizeSpans(record.spans),
    },
  ];
}
