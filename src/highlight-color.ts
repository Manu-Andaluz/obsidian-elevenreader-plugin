export const DEFAULT_HIGHLIGHT_COLOR = "#f0c14a";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function normalizeHighlightColor(value: unknown): string {
  if (typeof value === "string" && HEX_COLOR.test(value)) return value.toLowerCase();
  return DEFAULT_HIGHLIGHT_COLOR;
}
