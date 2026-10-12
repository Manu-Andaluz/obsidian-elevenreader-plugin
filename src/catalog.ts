export interface CatalogChoice {
  id: string;
  name: string;
}

export interface VoiceCollection {
  id: string;
  name: string;
}

const MODELS_URL = "https://api.elevenlabs.io/v1/models";
const COLLECTIONS_URL = "https://api.elevenlabs.io/v1/voices/collections";

export function modelsUrl(): string {
  return MODELS_URL;
}

export function collectionsUrl(): string {
  return COLLECTIONS_URL;
}

export function voicesPageUrl(
  voiceType: string | null,
  pageToken: string | null,
  collectionId?: string,
): string {
  const url = new URL("https://api.elevenlabs.io/v2/voices");
  url.searchParams.set("page_size", "100");
  url.searchParams.set("include_total_count", "false");
  if (voiceType) url.searchParams.set("voice_type", voiceType);
  if (collectionId) url.searchParams.set("collection_id", collectionId);
  if (pageToken) url.searchParams.set("next_page_token", pageToken);
  return url.toString();
}

export function parseVoiceCollections(body: string): VoiceCollection[] {
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object") return [];
  const collections = (parsed as { collections?: unknown }).collections;
  if (!Array.isArray(collections)) return [];
  return collections.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const collection = value as { collection_id?: unknown; title?: unknown };
    if (typeof collection.collection_id !== "string" || !collection.collection_id.trim()) return [];
    const id = collection.collection_id.trim();
    const name = typeof collection.title === "string" && collection.title.trim()
      ? collection.title.trim()
      : id;
    return [{ id, name }];
  });
}

export function parseVoicesPage(body: string): {
  voices: CatalogChoice[];
  hasMore: boolean;
  nextPageToken: string | null;
} {
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object") {
    return { voices: [], hasMore: false, nextPageToken: null };
  }
  const page = parsed as {
    voices?: unknown;
    has_more?: unknown;
    next_page_token?: unknown;
  };
  const nextPageToken =
    typeof page.next_page_token === "string" && page.next_page_token
      ? page.next_page_token
      : null;
  return {
    voices: Array.isArray(page.voices) ? page.voices.flatMap(readVoice) : [],
    hasMore: page.has_more === true && nextPageToken !== null,
    nextPageToken,
  };
}

export function parseSpeechModels(body: string): CatalogChoice[] {
  const parsed: unknown = JSON.parse(body);
  if (!Array.isArray(parsed)) return [];
  return sortChoices(parsed.flatMap(readModel));
}

export async function loadVoiceCatalog(
  fetchText: (url: string) => Promise<string>,
  collectionId?: string,
): Promise<CatalogChoice[]> {
  const byId = new Map<string, CatalogChoice>();
  let pageToken: string | null = null;
  const seenTokens = new Set<string>();
  while (true) {
    const parsed = parseVoicesPage(await fetchText(voicesPageUrl(null, pageToken, collectionId)));
    for (const voice of parsed.voices) {
      if (!byId.has(voice.id)) byId.set(voice.id, voice);
    }
    if (!parsed.hasMore || !parsed.nextPageToken || seenTokens.has(parsed.nextPageToken)) break;
    seenTokens.add(parsed.nextPageToken);
    pageToken = parsed.nextPageToken;
  }
  return sortChoices([...byId.values()]);
}

export function ensureChoice(choices: CatalogChoice[], currentId: string): CatalogChoice[] {
  const id = currentId.trim();
  if (!id || choices.some((choice) => choice.id === id)) return choices;
  return sortChoices([...choices, { id, name: id }]);
}

export function choiceLabels(choices: CatalogChoice[]): Record<string, string> {
  const counts = new Map<string, number>();
  for (const choice of choices) {
    counts.set(choice.name, (counts.get(choice.name) ?? 0) + 1);
  }
  const labels: Record<string, string> = {};
  for (const choice of choices) {
    const duplicated = (counts.get(choice.name) ?? 0) > 1;
    labels[choice.id] = duplicated ? `${choice.name} (${choice.id.slice(0, 6)})` : choice.name;
  }
  return labels;
}

function readVoice(value: unknown): CatalogChoice[] {
  if (!value || typeof value !== "object") return [];
  const voice = value as { voice_id?: unknown; name?: unknown };
  if (typeof voice.voice_id !== "string" || !voice.voice_id.trim()) return [];
  const id = voice.voice_id.trim();
  const name = typeof voice.name === "string" && voice.name.trim() ? voice.name.trim() : id;
  return [{ id, name }];
}

function readModel(value: unknown): CatalogChoice[] {
  if (!value || typeof value !== "object") return [];
  const model = value as {
    model_id?: unknown;
    name?: unknown;
    can_do_text_to_speech?: unknown;
  };
  if (model.can_do_text_to_speech !== true) return [];
  if (typeof model.model_id !== "string" || !model.model_id.trim()) return [];
  const id = model.model_id.trim();
  const name = typeof model.name === "string" && model.name.trim() ? model.name.trim() : id;
  return [{ id, name }];
}

function sortChoices(choices: CatalogChoice[]): CatalogChoice[] {
  return [...choices].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
