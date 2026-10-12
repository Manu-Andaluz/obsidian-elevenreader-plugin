export interface ReaderAction {
  id: string;
  name: string;
  run(): void;
}

export const READER_ACTIONS = [
  { id: "narrate-current-note", name: "Narrate current note" },
  { id: "open-player", name: "Open player" },
  { id: "stop-narration", name: "Stop narration" },
  { id: "remove-saved-narration", name: "Remove saved narration" },
  { id: "export-audio", name: "Export audio" },
] as const;

export type ReaderActionId = (typeof READER_ACTIONS)[number]["id"];
