import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

const setSpokenRange = StateEffect.define<{ from: number; to: number } | null>();

const spokenMark = Decoration.mark({ class: "elevenlabs-spoken" });

export const spokenField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, transaction) {
    if (transaction.docChanged) return Decoration.none;
    for (const effect of transaction.effects) {
      if (!effect.is(setSpokenRange)) continue;
      const range = effect.value;
      if (!range || range.from < 0 || range.to <= range.from || range.to > transaction.state.doc.length) {
        return Decoration.none;
      }
      return Decoration.set([spokenMark.range(range.from, range.to)]);
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function showSpokenRange(view: EditorView, from: number, to: number): void {
  view.dispatch({ effects: setSpokenRange.of({ from, to }) });
}

export function clearSpokenRange(view: EditorView): void {
  view.dispatch({ effects: setSpokenRange.of(null) });
}
