import { MarkdownView, Notice, Plugin, TFile, base64ToArrayBuffer, requestUrl } from "obsidian";
import { READER_ACTIONS, type ReaderAction, type ReaderActionId } from "./actions";
import { ReaderActionsModal } from "./actions-modal";
import { EditorView } from "@codemirror/view";
import { loadVoiceCatalog, modelsUrl, parseSpeechModels, type CatalogChoice } from "./catalog";
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
} from "./history";
import { narrationText } from "./note-text";
import { clearSpokenRange, showSpokenRange, spokenField } from "./editor-highlight";
import { MiniPlayer, type PlayerPhase } from "./player";
import { normalizeHighlightColor } from "./highlight-color";
import { normalizeSkipSeconds, type SkipSeconds } from "./player-geometry";
import {
  API_KEY_SECRET_ID,
  DEFAULT_SETTINGS,
  ReaderSettingTab,
  type ReaderSettings,
} from "./settings";
import { locatePreviewSpan, textNodeSpan } from "./preview-highlight";
import { estimatedSpans, spanAtTime, spokenBounds, wordSpans, type SpokenSpan } from "./spoken";
import {
  OUTPUT_FORMAT,
  SpeechRequestError,
  messageFromElevenLabs,
  requestAlignedSpeech,
  type SpeechTransport,
} from "./speech";

export default class ElevenLabsReaderPlugin extends Plugin {
  settings: ReaderSettings = { ...DEFAULT_SETTINGS };

  private phase: PlayerPhase = "idle";
  private generation = 0;
  private audio: HTMLAudioElement | null = null;
  private audioUrl: string | null = null;
  private player: MiniPlayer | null = null;
  private script: { path: string; text: string; spans: SpokenSpan[] | null } | null = null;
  private highlightView: EditorView | null = null;
  private highlightKey = "";

  async onload(): Promise<void> {
    await this.loadSettings();

    this.player = new MiniPlayer({
      onPlay: () => {
        this.resumeOrNarrate();
      },
      onPause: () => {
        this.pauseOrCancel();
      },
      onSeek: (seconds) => {
        this.seek(seconds);
      },
      onPlace: (left, top) => {
        this.settings.playerLeft = left;
        this.settings.playerTop = top;
        void this.saveSettings();
      },
    });
    this.player.setSkipSeconds(this.settings.skipSeconds);
    this.applyHighlightColor();
    this.register(() => this.player?.destroy());
    this.restorePlayerPlace();

    this.addSettingTab(new ReaderSettingTab(this.app, this));
    this.registerEditorExtension(spokenField);
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.highlightKey = "";
        if (this.audio) this.syncHighlight(this.audio.currentTime, this.audio.duration);
        else this.clearHighlight();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.highlightKey = "";
        if (this.audio) this.syncHighlight(this.audio.currentTime, this.audio.duration);
      }),
    );

    for (const action of this.readerActions()) {
      this.addCommand({
        id: action.id,
        name: action.name,
        hotkeys: action.id === "open-player" ? [{ modifiers: ["Mod", "Shift"], key: "l" }] : undefined,
        callback: () => {
          action.run();
        },
      });
    }

    this.addCommand({
      id: "open-actions",
      name: "Open actions",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "a" }],
      callback: () => {
        this.openActions();
      },
    });
  }

  private readerActions(): ReaderAction[] {
    const run: Record<ReaderActionId, () => void> = {
      "narrate-current-note": () => {
        void this.narrateCurrentNote();
      },
      "open-player": () => {
        this.player?.show();
      },
      "stop-narration": () => {
        this.stopNarration();
      },
      "remove-saved-narration": () => {
        void this.removeSavedNarration();
      },
    };
    return READER_ACTIONS.map((action) => ({
      id: action.id,
      name: action.name,
      run: run[action.id],
    }));
  }

  private openActions(): void {
    new ReaderActionsModal(this.app, this.readerActions()).open();
  }

  onunload(): void {
    this.generation += 1;
    this.releaseAudio();
    this.clearHighlight();
    document.body.style.removeProperty("--elevenlabs-spoken");
    document.documentElement.style.removeProperty("--elevenlabs-spoken");
    clearPreviewHighlight();
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<ReaderSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...stored,
      skipSeconds: normalizeSkipSeconds(stored?.skipSeconds),
      highlightColor: normalizeHighlightColor(stored?.highlightColor),
      generations: sanitizeGenerations(stored?.generations),
    };
  }

  setHighlightColor(color: string): void {
    this.settings.highlightColor = normalizeHighlightColor(color);
    this.applyHighlightColor();
    void this.saveSettings();
  }

  private applyHighlightColor(): void {
    document.body.style.setProperty("--elevenlabs-spoken", this.settings.highlightColor);
    document.documentElement.style.setProperty("--elevenlabs-spoken", this.settings.highlightColor);
  }

  setSkipSeconds(seconds: SkipSeconds): void {
    this.settings.skipSeconds = seconds;
    this.player?.setSkipSeconds(seconds);
    void this.saveSettings();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  getApiKey(): string {
    return this.app.secretStorage.getSecret(API_KEY_SECRET_ID)?.trim() ?? "";
  }

  setApiKey(value: string): void {
    this.app.secretStorage.setSecret(API_KEY_SECRET_ID, value.trim());
  }

  async listVoices(): Promise<CatalogChoice[]> {
    return loadVoiceCatalog((url) => this.elevenText(url));
  }

  async listModels(): Promise<CatalogChoice[]> {
    return parseSpeechModels(await this.elevenText(modelsUrl()));
  }

  private async elevenText(url: string): Promise<string> {
    const response = await requestUrl({
      url,
      method: "GET",
      headers: { "xi-api-key": this.getApiKey() },
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new SpeechRequestError(
        messageFromElevenLabs(response.status, response.text),
        response.status,
      );
    }
    return response.text;
  }

  private restorePlayerPlace(): void {
    const { playerLeft, playerTop } = this.settings;
    if (playerLeft === null || playerTop === null) return;
    this.player?.place(playerLeft, playerTop);
  }

  private resumeOrNarrate(): void {
    if (this.audio && this.phase !== "generating") {
      this.player?.show();
      void this.audio.play().catch((error: unknown) => {
        this.failPlayback(error);
      });
      return;
    }
    void this.narrateCurrentNote();
  }

  private pauseOrCancel(): void {
    if (this.phase === "generating") {
      this.stopNarration();
      return;
    }
    this.audio?.pause();
  }

  private seek(seconds: number): void {
    if (!this.audio || this.phase === "generating") return;
    if (!Number.isFinite(seconds)) return;
    this.audio.currentTime = seconds;
  }

  private async removeSavedNarration(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      new Notice("Open a note to remove its saved narration.");
      return;
    }

    const text = narrationText(await this.app.vault.read(file));
    if (!text) {
      new Notice("This note has no saved narration.");
      return;
    }

    const fingerprint = await narrationFingerprint({
      text,
      voiceId: this.settings.voiceId,
      modelId: this.settings.modelId,
      outputFormat: OUTPUT_FORMAT,
    });
    const matches = reusableMatches(this.settings.generations, fingerprint);
    const current = matches[0];
    if (!current) {
      new Notice("This note has no saved narration.");
      return;
    }

    this.settings.generations = removeGeneration(this.settings.generations, current.historyItemId);
    await this.saveSettings();
    new Notice(
      matches.length > 1
        ? "Saved narration removed."
        : "Saved narration removed. Narrate again to generate a replacement.",
    );
  }

  private async narrateCurrentNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      this.report("Open a note to narrate.");
      return;
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.report("Add an ElevenLabs API key in plugin settings.");
      this.openSettings();
      return;
    }

    const text = narrationText(await this.app.vault.read(file));
    if (!text) {
      this.report("This note has nothing to narrate.");
      return;
    }

    const token = ++this.generation;
    this.releaseAudio();
    this.script = null;
    this.clearHighlight();
    this.setPhase("generating");
    this.player?.show();
    this.player?.setProgress(0, 0);

    const fingerprint = await narrationFingerprint({
      text,
      voiceId: this.settings.voiceId,
      modelId: this.settings.modelId,
      outputFormat: OUTPUT_FORMAT,
    });
    if (token !== this.generation) return;

    const matches = reusableMatches(this.settings.generations, fingerprint);
    if (matches.length > 0) {
      const reused = await this.tryReuse(matches, token, file.path, text);
      if (reused !== "generate") return;
    }

    try {
      const result = await requestAlignedSpeech(
        {
          apiKey,
          voiceId: this.settings.voiceId,
          modelId: this.settings.modelId,
          text,
        },
        obsidianTransport(),
      );
      if (token !== this.generation) return;
      const spans = wordSpans(text, result.characters, result.starts, result.ends);
      const verified = await this.verifyForReuse(result.historyItemId, fingerprint, token, spans);
      if (token !== this.generation) return;
      this.script = { path: file.path, text, spans };
      this.play(verified ?? base64ToArrayBuffer(result.audioBase64), token);
    } catch (error) {
      if (token !== this.generation) return;
      this.setPhase("idle");
      this.report(errorText(error));
    }
  }

  private async tryReuse(
    matches: GenerationRecord[],
    token: number,
    path: string,
    text: string,
  ): Promise<"done" | "generate"> {
    let missing = false;
    for (const match of matches) {
      if (token !== this.generation) return "done";
      try {
        const audio = await this.fetchHistoryAudio(match.historyItemId);
        if (token !== this.generation) return "done";
        this.script = { path, text, spans: match.spans };
        this.play(audio, token);
        return "done";
      } catch (error) {
        if (token !== this.generation) return "done";
        if (error instanceof SpeechRequestError && isMissingAudio(error.status)) {
          this.settings.generations = retireGeneration(
            this.settings.generations,
            match.historyItemId,
          );
          await this.saveSettings();
          missing = true;
          continue;
        }
        this.setPhase("idle");
        this.report(errorText(error));
        return "done";
      }
    }
    if (!missing) return "generate";
    this.setPhase("idle");
    this.report("The saved narration is no longer available. Narrate again to generate a new one.");
    return "done";
  }

  private async verifyForReuse(
    historyItemId: string | null,
    fingerprint: string,
    token: number,
    spans: SpokenSpan[] | null,
  ): Promise<ArrayBuffer | null> {
    if (!historyItemId) {
      console.error("ElevenLabs Reader: no history item id, so this narration will not be reused.");
      return null;
    }
    try {
      const audio = await this.fetchVerifiedAudio(historyItemId, token);
      if (token !== this.generation) return null;
      this.settings.generations = rememberGeneration(this.settings.generations, {
        historyItemId,
        fingerprint,
        createdAt: Date.now(),
        reusable: true,
        spans,
      });
      await this.saveSettings();
      return audio;
    } catch (error) {
      console.error(`ElevenLabs Reader: narration was not saved for reuse. ${errorText(error)}`);
      return null;
    }
  }

  private async fetchVerifiedAudio(historyItemId: string, token: number): Promise<ArrayBuffer> {
    try {
      return await this.fetchHistoryAudio(historyItemId);
    } catch (error) {
      if (token !== this.generation) throw error;
      if (!(error instanceof SpeechRequestError) || error.status !== 404) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      if (token !== this.generation) throw error;
      return this.fetchHistoryAudio(historyItemId);
    }
  }

  private async fetchHistoryAudio(historyItemId: string): Promise<ArrayBuffer> {
    const response = await requestUrl({
      url: historyAudioUrl(historyItemId),
      method: "GET",
      headers: {
        "xi-api-key": this.getApiKey(),
        Accept: "audio/mpeg",
      },
      throw: false,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new SpeechRequestError(
        messageFromElevenLabs(response.status, response.text),
        response.status,
      );
    }
    if (response.arrayBuffer.byteLength === 0) {
      throw new SpeechRequestError("ElevenLabs returned no audio for this narration.", 404);
    }
    return response.arrayBuffer;
  }

  private play(bytes: ArrayBuffer, token: number): void {
    const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
    const audio = new Audio(url);
    this.audio = audio;
    this.audioUrl = url;

    const sync = (): void => {
      if (token !== this.generation) return;
      this.player?.setProgress(audio.currentTime, audio.duration);
      this.syncHighlight(audio.currentTime, audio.duration);
    };

    audio.addEventListener("timeupdate", sync);
    audio.addEventListener("durationchange", sync);
    audio.addEventListener("seeked", sync);
    audio.addEventListener("play", () => {
      if (token !== this.generation) return;
      this.setPhase("playing");
    });
    audio.addEventListener("pause", () => {
      if (token !== this.generation || audio.ended) return;
      this.setPhase("paused");
    });
    audio.addEventListener("ended", () => {
      if (token !== this.generation) return;
      this.setPhase("paused");
      this.player?.setProgress(audio.duration, audio.duration);
      this.script = null;
      this.clearHighlight();
    });
    audio.addEventListener("error", () => {
      if (token !== this.generation) return;
      this.releaseAudio();
      this.script = null;
      this.clearHighlight();
      this.setPhase("idle");
      this.report("Obsidian could not play the generated audio.");
    });

    void audio.play().catch((error: unknown) => {
      if (token !== this.generation) return;
      this.failPlayback(error);
    });
  }

  private failPlayback(error: unknown): void {
    this.releaseAudio();
    this.script = null;
    this.clearHighlight();
    this.setPhase("idle");
    this.report(errorText(error));
  }

  private syncHighlight(current: number, duration: number): void {
    const script = this.script;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!script || !view || view.file?.path !== script.path) {
      this.clearHighlight();
      return;
    }
    const markdown = view.editor.getValue();
    const bounds = spokenBounds(markdown);
    if (!bounds || bounds.text !== script.text) {
      this.clearHighlight();
      return;
    }
    const spans = script.spans ?? estimatedSpans(script.text, duration);
    const span = spanAtTime(spans, current);
    if (!span) {
      this.clearHighlight();
      return;
    }
    if (view.getMode() === "preview") {
      this.clearEditorHighlight();
      this.showPreviewHighlight(view, script.text.slice(span.from, span.to), span.from, script.text.length);
      return;
    }
    clearPreviewHighlight();
    const from = bounds.start + span.from;
    const to = bounds.start + span.to;
    const cm = codeMirrorOf(view);
    if (!cm) {
      this.clearEditorHighlight();
      return;
    }
    const key = `source:${from}:${to}:${markdown.length}`;
    if (this.highlightView === cm && this.highlightKey === key) return;
    if (this.highlightView && this.highlightView !== cm) clearSpokenRange(this.highlightView);
    this.highlightView = cm;
    this.highlightKey = key;
    showSpokenRange(cm, from, to);
  }

  private showPreviewHighlight(view: MarkdownView, token: string, sourceFrom: number, sourceLength: number): void {
    const root = view.containerEl.querySelector(".markdown-preview-view");
    if (!(root instanceof HTMLElement)) {
      clearPreviewHighlight();
      this.highlightKey = "";
      return;
    }
    const nodes = previewTextNodes(root);
    const previewText = nodes.map((node) => node.textContent ?? "").join("");
    const located = locatePreviewSpan(previewText, token, sourceFrom, sourceLength);
    const placed = located ? textNodeSpan(nodes.map((node) => node.textContent?.length ?? 0), located.start, located.end) : null;
    if (!located || !placed) {
      clearPreviewHighlight();
      this.highlightKey = "";
      return;
    }
    const key = `preview:${located.start}:${located.end}:${token}`;
    if (this.highlightKey === key) return;
    const startNode = nodes[placed.startNode];
    const endNode = nodes[placed.endNode];
    if (!startNode || !endNode) {
      clearPreviewHighlight();
      this.highlightKey = "";
      return;
    }
    const range = document.createRange();
    range.setStart(startNode, placed.startOffset);
    range.setEnd(endNode, placed.endOffset);
    if (!paintPreviewRange(range)) {
      this.highlightKey = "";
      return;
    }
    this.highlightKey = key;
  }

  private clearHighlight(): void {
    this.clearEditorHighlight();
    clearPreviewHighlight();
    this.highlightKey = "";
  }

  private clearEditorHighlight(): void {
    if (this.highlightView) clearSpokenRange(this.highlightView);
    this.highlightView = null;
  }

  private stopNarration(): void {
    if (this.phase === "idle" && !this.audio) {
      new Notice("No narration is running.");
      return;
    }
    this.generation += 1;
    this.releaseAudio();
    this.setPhase("idle");
    this.script = null;
    this.clearHighlight();
    this.player?.setProgress(0, 0);
    new Notice("Narration cancelled.");
  }

  private setPhase(phase: PlayerPhase): void {
    this.phase = phase;
    this.player?.setPhase(phase);
  }

  private releaseAudio(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }
  }

  private report(message: string): void {
    new Notice(message);
    console.error(`ElevenLabs Reader: ${message}`);
  }

  private openSettings(): void {
    const setting = (this.app as unknown as AppWithSettings).setting;
    setting.open();
    setting.openTabById(this.manifest.id);
  }
}

function codeMirrorOf(view: MarkdownView): EditorView | null {
  const cm = (view.editor as { cm?: unknown }).cm;
  return cm instanceof EditorView ? cm : null;
}

function previewTextNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text) nodes.push(current);
    current = walker.nextNode();
  }
  return nodes;
}

function paintPreviewRange(range: Range): boolean {
  const highlights = previewRegistry();
  const HighlightCtor = (globalThis as unknown as { Highlight?: new () => PreviewHighlight }).Highlight;
  if (!highlights || !HighlightCtor) return false;
  let entry = highlights.get(PREVIEW_HIGHLIGHT);
  if (!entry) {
    entry = new HighlightCtor();
    highlights.set(PREVIEW_HIGHLIGHT, entry);
  }
  entry.clear();
  entry.add(range);
  return true;
}

function clearPreviewHighlight(): void {
  previewRegistry()?.get(PREVIEW_HIGHLIGHT)?.clear();
}

function previewRegistry(): PreviewHighlightRegistry | undefined {
  return (globalThis as unknown as { CSS?: { highlights?: PreviewHighlightRegistry } }).CSS?.highlights;
}

const PREVIEW_HIGHLIGHT = "elevenlabs-spoken";

interface PreviewHighlight {
  add(range: Range): void;
  clear(): void;
}

interface PreviewHighlightRegistry {
  get(name: string): PreviewHighlight | undefined;
  set(name: string, value: PreviewHighlight): void;
}

function obsidianTransport(): SpeechTransport {
  return {
    async post(url, body, headers) {
      const response = await requestUrl({
        url,
        method: "POST",
        headers,
        body,
        throw: false,
      });
      return {
        status: response.status,
        headers: response.headers ?? {},
        async arrayBuffer() {
          return response.arrayBuffer;
        },
        async text() {
          return response.text;
        },
      };
    },
  };
}

interface AppWithSettings {
  setting: {
    open(): void;
    openTabById(id: string): void;
  };
}

function errorText(error: unknown): string {
  if (error instanceof SpeechRequestError) return error.message;
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Narration failed.";
}
