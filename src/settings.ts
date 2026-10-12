import { App, DropdownComponent, PluginSettingTab, Setting } from "obsidian";
import { choiceLabels, ensureChoice, type CatalogChoice } from "./catalog";
import type { GenerationRecord } from "./history";
import type ElevenLabsReaderPlugin from "./main";

export interface ReaderSettings {
  voiceId: string;
  modelId: string;
  playerLeft: number | null;
  playerTop: number | null;
  generations: GenerationRecord[];
}

export const API_KEY_SECRET_ID = "elevenlabs-api-key";

export const DEFAULT_SETTINGS: ReaderSettings = {
  voiceId: "JBFqnCBsd6RMkjVDRZzb",
  modelId: "eleven_multilingual_v2",
  playerLeft: null,
  playerTop: null,
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

    let voiceDropdown!: DropdownComponent;
    const voiceSetting = new Setting(containerEl)
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

    let modelDropdown!: DropdownComponent;
    const modelSetting = new Setting(containerEl)
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
      .setName("Library")
      .setDesc("Voices and speech models on your ElevenLabs account.")
      .addButton((button) => {
        button.setButtonText("Refresh").onClick(() => {
          void this.loadCatalog(voiceDropdown, modelDropdown, voiceSetting, modelSetting);
        });
      });

    void this.loadCatalog(voiceDropdown, modelDropdown, voiceSetting, modelSetting);
  }

  private async loadCatalog(
    voiceDropdown: DropdownComponent,
    modelDropdown: DropdownComponent,
    voiceSetting: Setting,
    modelSetting: Setting,
  ): Promise<void> {
    const token = ++this.catalogToken;
    if (!this.plugin.getApiKey()) {
      voiceSetting.setDesc("Add an API key to load your voices. The saved choice is kept.");
      modelSetting.setDesc("Add an API key to load speech models. The saved choice is kept.");
      return;
    }

    voiceSetting.setDesc("Loading voices…");
    modelSetting.setDesc("Loading models…");
    try {
      const [voices, models] = await Promise.all([
        this.plugin.listVoices(),
        this.plugin.listModels(),
      ]);
      if (token !== this.catalogToken) return;
      this.fillDropdown(voiceDropdown, this.plugin.settings.voiceId, voices);
      this.fillDropdown(modelDropdown, this.plugin.settings.modelId, models);
      voiceSetting.setDesc("Used the next time you narrate.");
      modelSetting.setDesc("Used the next time you narrate.");
    } catch (error) {
      if (token !== this.catalogToken) return;
      const message = error instanceof Error ? error.message : "Could not load ElevenLabs.";
      voiceSetting.setDesc(message);
      modelSetting.setDesc(message);
    }
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
