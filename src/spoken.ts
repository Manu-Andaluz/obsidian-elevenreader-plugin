export interface SpokenSpan {
  from: number;
  to: number;
  start: number;
  end: number;
}

export function spokenBounds(markdown: string): { start: number; text: string } | null {
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown);
  const bodyStart = frontmatter?.[0].length ?? 0;
  const body = markdown.slice(bodyStart);
  const leading = body.length - body.trimStart().length;
  const text = body.trim();
  if (!text) return null;
  return { start: bodyStart + leading, text };
}

export function wordSpans(
  text: string,
  characters: string[],
  starts: number[],
  ends: number[],
): SpokenSpan[] | null {
  if (characters.join("") !== text) return null;
  if (starts.length !== text.length || ends.length !== text.length) return null;
  const spans: SpokenSpan[] = [];
  for (const word of wordRanges(text)) {
    const start = starts[word.from];
    const end = ends[word.to - 1];
    if (start === undefined || end === undefined || !Number.isFinite(start) || !Number.isFinite(end)) {
      return null;
    }
    spans.push({ from: word.from, to: word.to, start, end });
  }
  return spans;
}

export function estimatedSpans(text: string, duration: number): SpokenSpan[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const words = wordRanges(text);
  if (words.length === 0) return [];
  const slice = duration / words.length;
  return words.map((word, index) => ({
    from: word.from,
    to: word.to,
    start: index * slice,
    end: (index + 1) * slice,
  }));
}

export function spanAtTime(spans: SpokenSpan[], time: number): SpokenSpan | null {
  if (!Number.isFinite(time)) return null;
  let chosen: SpokenSpan | null = null;
  for (const span of spans) {
    if (span.start <= time) chosen = span;
    else break;
  }
  return chosen;
}

export function sanitizeSpans(value: unknown): SpokenSpan[] | null {
  if (!Array.isArray(value)) return null;
  const spans: SpokenSpan[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const span = item as Partial<SpokenSpan>;
    const numbers = [span.from, span.to, span.start, span.end];
    if (!numbers.every((number) => typeof number === "number" && Number.isFinite(number))) return null;
    if (span.from! < 0 || span.to! <= span.from! || span.end! < span.start!) return null;
    spans.push({ from: span.from!, to: span.to!, start: span.start!, end: span.end! });
  }
  return spans;
}

function wordRanges(text: string): { from: number; to: number }[] {
  const words: { from: number; to: number }[] = [];
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index] ?? "")) index += 1;
    const from = index;
    while (index < text.length && !/\s/.test(text[index] ?? "")) index += 1;
    if (from < index) words.push({ from, to: index });
  }
  return words;
}
