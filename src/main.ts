import { MarkdownView, Notice, Plugin, TFile, base64ToArrayBuffer, requestUrl } from "obsidian";
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
import {
  API_KEY_SECRET_ID,
  DEFAULT_SETTINGS,
  ReaderSettingTab,
  type ReaderSettings,
} from "./settings";
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

    this.addCommand({
      id: "narrate-current-note",
      name: "Narrate current note",
      callback: () => {
        void this.narrateCurrentNote();
      },
    });

    this.addCommand({
      id: "open-player",
      name: "Open player",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "l" }],
      callback: () => {
        this.player?.show();
      },
    });

    this.addCommand({
      id: "stop-narration",
      name: "Stop narration",
      callback: () => {
        this.stopNarration();
      },
    });

    this.addCommand({
      id: "remove-saved-narration",
      name: "Remove saved narration",
      callback: () => {
        void this.removeSavedNarration();
      },
    });
  }

  onunload(): void {
    this.generation += 1;
    this.releaseAudio();
    this.clearHighlight();
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<ReaderSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...stored,
      generations: sanitizeGenerations(stored?.generations),
    };
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
    const view = this.activeEditor();
    if (!script || !view) {
      this.clearHighlight();
      return;
    }
    const markdown = view.editor.getValue();
    const bounds = spokenBounds(markdown);
    if (!bounds || view.file?.path !== script.path || bounds.text !== script.text) {
      this.clearHighlight();
      return;
    }
    const spans = script.spans ?? estimatedSpans(script.text, duration);
    const span = spanAtTime(spans, current);
    const cm = codeMirrorOf(view);
    if (!span || !cm) {
      this.clearHighlight();
      return;
    }
    const from = bounds.start + span.from;
    const to = bounds.start + span.to;
    const key = `${from}:${to}:${markdown.length}`;
    if (this.highlightView === cm && this.highlightKey === key) return;
    if (this.highlightView && this.highlightView !== cm) clearSpokenRange(this.highlightView);
    this.highlightView = cm;
    this.highlightKey = key;
    showSpokenRange(cm, from, to);
  }

  private clearHighlight(): void {
    if (this.highlightView) clearSpokenRange(this.highlightView);
    this.highlightView = null;
    this.highlightKey = "";
  }

  private activeEditor(): MarkdownView | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.getMode() === "preview") return null;
    return view;
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
