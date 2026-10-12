import { isMissingAudio } from "./history.ts";
import type { GenerationRecord } from "./history.ts";
import { SpeechRequestError } from "./speech.ts";

/** Vault-root folder. From `.obsidian/plugins/elevenlabs-reader` this is `../../../audios`. */
export const DEFAULT_EXPORT_FOLDER = "audios";

const MAX_EXPORT_SUFFIX = 999;

export interface ExportFiles {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  write(path: string, data: ArrayBuffer): Promise<void>;
}

export function normalizeExportFolder(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_EXPORT_FOLDER;
  const parts = value.split(/[\\/]+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return DEFAULT_EXPORT_FOLDER;
  if (parts.some((part) => part === "." || part === ".." || /[\u0000-\u001f]/.test(part))) {
    return DEFAULT_EXPORT_FOLDER;
  }
  return parts.join("/");
}

export function exportBaseName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return cleaned || "narration";
}

export function exportPath(folder: string, base: string, index: number): string {
  const name = index <= 1 ? `${base}.mp3` : `${base} ${index}.mp3`;
  return `${folder}/${name}`;
}

export async function saveExport(
  files: ExportFiles,
  folder: string,
  title: string,
  audio: ArrayBuffer,
): Promise<string> {
  const destination = normalizeExportFolder(folder);
  await ensureFolder(files, destination);
  const base = exportBaseName(title);
  for (let index = 1; index <= MAX_EXPORT_SUFFIX; index += 1) {
    const path = exportPath(destination, base, index);
    if (await files.exists(path)) continue;
    await files.write(path, audio);
    return path;
  }
  throw new Error("Could not find a free filename for this export.");
}

export async function audioFromHistory(
  matches: readonly GenerationRecord[],
  fetchAudio: (historyItemId: string) => Promise<ArrayBuffer>,
): Promise<{ audio: ArrayBuffer; historyItemId: string } | { missingIds: string[] }> {
  const missingIds: string[] = [];
  for (const match of matches) {
    try {
      const audio = await fetchAudio(match.historyItemId);
      return { audio, historyItemId: match.historyItemId };
    } catch (error) {
      if (error instanceof SpeechRequestError && isMissingAudio(error.status)) {
        missingIds.push(match.historyItemId);
        continue;
      }
      throw error;
    }
  }
  return { missingIds };
}

async function ensureFolder(files: ExportFiles, folder: string): Promise<void> {
  let current = "";
  for (const part of folder.split("/")) {
    current = current ? `${current}/${part}` : part;
    if (await files.exists(current)) continue;
    await files.mkdir(current);
  }
}
