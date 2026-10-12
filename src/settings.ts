import { App, DropdownComponent, PluginSettingTab, Setting } from "obsidian";
import { choiceLabels, ensureChoice, type CatalogChoice, type VoiceCollection } from "./catalog";
import { DEFAULT_HIGHLIGHT_COLOR } from "./highlight-color";
import { DEFAULT_SKIP_SECONDS, SKIP_SECONDS, type SkipSeconds } from "./player-geometry";
import { DEFAULT_EXPORT_FOLDER, normalizeExportFolder } from "./export-audio";
import type { GenerationRecord } from "./history";
import type ElevenLabsReaderPlugin from "./main";

export interface ReaderSettings {
  voiceId: string;
  voiceCollectionId: string;
  modelId: string;
  playerLeft: number | null;
  playerTop: number | null;
  skipSeconds: SkipSeconds;
  highlightColor: string;
  exportFolder: string;
  generations: GenerationRecord[];
}

export const API_KEY_SECRET_ID = "elevenlabs-api-key";

export const DEFAULT_SETTINGS: ReaderSettings = {
  voiceId: "JBFqnCBsd6RMkjVDRZzb",
  voiceCollectionId: "",
  modelId: "eleven_multilingual_v2",
  playerLeft: null,
  playerTop: null,
  skipSeconds: DEFAULT_SKIP_SECONDS,
  highlightColor: DEFAULT_HIGHLIGHT_COLOR,
  exportFolder: DEFAULT_EXPORT_FOLDER,
  generations: [],
};

export class ReaderSettingTab extends PluginSettingTab {
  private catalogToken = 0;

  constructor(
    app: App,
    private readonly plugin: ElevenLabsReaderPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Stored in Obsidian secret storage for this vault, not in the plugin source.")
      .addText((text) => {
        text
          .setPlaceholder("xi-...")
          .setValue(this.plugin.getApiKey())
          .onChange((value) => {
            this.plugin.setApiKey(value);
          });
        text.inputEl.type = "password";
      });

    let collectionDropdown!: DropdownComponent;
    let voiceDropdown!: DropdownComponent;
    let modelDropdown!: DropdownComponent;
    let collectionSetting!: Setting;
    let voiceSetting!: Setting;
    let modelSetting!: Setting;
    collectionSetting = new Setting(containerEl)
      .setName("Voice collection")
      .setDesc("Show all voices or narrow the voice list to one collection.")
      .addDropdown((dropdown) => {
        collectionDropdown = dropdown;
        dropdown.addOption("", "All voices");
        dropdown.setValue(this.plugin.settings.voiceCollectionId ?? "");
        dropdown.onChange(async (value) => {
          this.plugin.settings.voiceCollectionId = value;
          await this.plugin.saveSettings();
          void this.loadCatalog(collectionDropdown, voiceDropdown, modelDropdown, collectionSetting, voiceSetting, modelSetting);
        });
      });

    voiceSetting = new Setting(containerEl)
      .setName("Voice")
      .setDesc("Used the next time you narrate.")
      .addDropdown((dropdown) => {
        voiceDropdown = dropdown;
        this.fillDropdown(dropdown, this.plugin.settings.voiceId, []);
        dropdown.onChange(async (value) => {
          this.plugin.settings.voiceId = value;
          await this.plugin.saveSettings();
        });
      });

    modelSetting = new Setting(containerEl)
      .setName("Model")
      .setDesc("Used the next time you narrate.")
      .addDropdown((dropdown) => {
        modelDropdown = dropdown;
        this.fillDropdown(dropdown, this.plugin.settings.modelId, []);
        dropdown.onChange(async (value) => {
          this.plugin.settings.modelId = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Skip")
      .setDesc("How far skip backward and skip forward jump.")
      .addDropdown((dropdown) => {
        for (const seconds of SKIP_SECONDS) {
          dropdown.addOption(String(seconds), `${seconds} seconds`);
        }
        dropdown.setValue(String(this.plugin.settings.skipSeconds)).onChange((value) => {
          const seconds = Number(value);
          if (seconds === 5 || seconds === 10 || seconds === 15) {
            this.plugin.setSkipSeconds(seconds);
          }
        });
      });

    new Setting(containerEl)
      .setName("Highlight")
      .setDesc("Color of the word being spoken. Pick a stronger color if a theme or snippet hides it.")
      .addColorPicker((picker) => {
        picker.setValue(this.plugin.settings.highlightColor).onChange((value) => {
          this.plugin.setHighlightColor(value);
        });
      });

    new Setting(containerEl)
      .setName("Export folder")
      .setDesc("Vault folder for exported MP3 files. The default, Audio, is the vault root: ../../../Audio from the installed plugin.")
      .addText((text) => {
        text.setPlaceholder(DEFAULT_EXPORT_FOLDER).setValue(this.plugin.settings.exportFolder).onChange((value) => {
          this.plugin.setExportFolder(value);
        });
      });

    new Setting(containerEl)
      .setName("Library")
      .setDesc("Voices and speech models on your ElevenLabs account.")
      .addButton((button) => {
        button.setButtonText("Refresh").onClick(() => {
          void this.loadCatalog(collectionDropdown, voiceDropdown, modelDropdown, collectionSetting, voiceSetting, modelSetting);
        });
      });

    void this.loadCatalog(collectionDropdown, voiceDropdown, modelDropdown, collectionSetting, voiceSetting, modelSetting);
  }

  private async loadCatalog(
    collectionDropdown: DropdownComponent,
    voiceDropdown: DropdownComponent,
    modelDropdown: DropdownComponent,
    collectionSetting: Setting,
    voiceSetting: Setting,
    modelSetting: Setting,
  ): Promise<void> {
    const token = ++this.catalogToken;
    if (!this.plugin.getApiKey()) {
      collectionSetting.setDesc("Add an API key to load your voice collections.");
      voiceSetting.setDesc("Add an API key to load your voices. The saved choice is kept.");
      modelSetting.setDesc("Add an API key to load speech models. The saved choice is kept.");
      return;
    }

    collectionSetting.setDesc("Loading collections…");
    voiceSetting.setDesc("Loading voices…");
    modelSetting.setDesc("Loading models…");
    try {
      const [collections, voices, models] = await Promise.all([
        this.plugin.listVoiceCollections(),
        this.plugin.listVoices(this.plugin.settings.voiceCollectionId),
        this.plugin.listModels(),
      ]);
      if (token !== this.catalogToken) return;
      this.fillCollectionDropdown(collectionDropdown, collections, this.plugin.settings.voiceCollectionId);
      this.fillDropdown(voiceDropdown, this.plugin.settings.voiceId, voices);
      this.fillDropdown(modelDropdown, this.plugin.settings.modelId, models);
      collectionSetting.setDesc("Filter the voice list by collection.");
      voiceSetting.setDesc("Used the next time you narrate.");
      modelSetting.setDesc("Used the next time you narrate.");
    } catch (error) {
      if (token !== this.catalogToken) return;
      const message = error instanceof Error ? error.message : "Could not load ElevenLabs.";
      collectionSetting.setDesc(message);
      voiceSetting.setDesc(message);
      modelSetting.setDesc(message);
    }
  }

  private fillCollectionDropdown(
    dropdown: DropdownComponent,
    collections: VoiceCollection[],
    selectedId: string,
  ): void {
    dropdown.selectEl.empty();
    dropdown.addOption("", "All voices");
    for (const collection of collections) {
      dropdown.addOption(collection.id, collection.name);
    }
    if (selectedId && !collections.some((collection) => collection.id === selectedId)) {
      dropdown.addOption(selectedId, "Unavailable collection");
    }
    dropdown.setValue(selectedId || "");
  }

  private fillDropdown(
    dropdown: DropdownComponent,
    currentId: string,
    choices: CatalogChoice[],
  ): void {
    const options = ensureChoice(choices, currentId);
    dropdown.selectEl.empty();
    dropdown.addOptions(choiceLabels(options));
    const selected = currentId.trim() || options[0]?.id || "";
    if (selected) dropdown.setValue(selected);
  }
}
