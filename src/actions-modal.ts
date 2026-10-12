import { Modal, type App } from "obsidian";
import type { ReaderAction } from "./actions";

export class ReaderActionsModal extends Modal {
  constructor(
    app: App,
    private readonly actions: readonly ReaderAction[],
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("Reader");
    this.modalEl.addClass("elevenlabs-actions");

    const list = document.createElement("div");
    list.addClass("elevenlabs-actions-list");

    for (const action of this.actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.addClass("elevenlabs-actions-item");
      button.setText(action.name);
      button.addEventListener("click", () => {
        this.close();
        action.run();
      });
      list.append(button);
    }

    this.contentEl.append(list);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
