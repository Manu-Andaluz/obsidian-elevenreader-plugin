export function visibleCandidates(token: string): string[] {
  const candidates: string[] = [];
  const add = (value: string | undefined): void => {
    const trimmed = value?.trim() ?? "";
    if (trimmed && !candidates.includes(trimmed)) candidates.push(trimmed);
  };

  add(token);
  add(/^\[([^\]]+)\]\([^)]*\)$/.exec(token)?.[1]);
  const wiki = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]$/.exec(token);
  if (wiki) add(wiki[2] || wiki[1]);
  add(/^`([^`]+)`$/.exec(token)?.[1]);
  add(token.replace(/^[#>*_~`]+|[#>*_~`]+$/g, ""));
  return candidates;
}

export function locatePreviewSpan(
  previewText: string,
  token: string,
  sourceFrom: number,
  sourceLength: number,
): { start: number; end: number } | null {
  if (!previewText || sourceLength <= 0) return null;
  const anchor = Math.min(
    previewText.length,
    Math.max(0, Math.round((sourceFrom / sourceLength) * previewText.length)),
  );
  for (const needle of visibleCandidates(token)) {
    const start = nearest(previewText, needle, anchor);
    if (start !== null) return { start, end: start + needle.length };
  }
  return null;
}

export function textNodeSpan(
  lengths: number[],
  start: number,
  end: number,
): { startNode: number; startOffset: number; endNode: number; endOffset: number } | null {
  if (end <= start || start < 0) return null;
  let offset = 0;
  let startNode = -1;
  let startOffset = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index] ?? 0;
    const next = offset + length;
    if (startNode < 0 && start < next) {
      startNode = index;
      startOffset = start - offset;
    }
    if (startNode >= 0 && end <= next) {
      return { startNode, startOffset, endNode: index, endOffset: end - offset };
    }
    offset = next;
  }
  return null;
}

function nearest(haystack: string, needle: string, anchor: number): number | null {
  if (!needle) return null;
  let from = 0;
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  while (from <= haystack.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    const distance = Math.abs(index - anchor);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
    if (index >= anchor) break;
    from = index + 1;
  }
  return best;
}
