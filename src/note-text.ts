/** Readable body of a note. Leading YAML frontmatter is not spoken. */
export function narrationText(markdown: string): string {
  const withoutFrontmatter = markdown.replace(
    /^---\r?\n[\s\S]*?\r?\n---\r?\n?/,
    "",
  );
  return stripFencedBlocks(withoutFrontmatter).trim();
}

/** Readable text selected in the editor. Frontmatter handling is note-only. */
export function narrationSelectionText(selection: string): string {
  return stripFencedBlocks(selection).trim();
}

/** Code and diagram blocks are fenced with three or four backticks. */
function stripFencedBlocks(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const spokenLines: string[] = [];
  let fenceLength: number | null = null;

  for (const line of lines) {
    if (fenceLength === null) {
      const opening = line.match(/^ {0,3}(`{3,4})[^`]*$/);
      if (opening) {
        fenceLength = opening[1].length;
        // Keep a paragraph break where the removed block was.
        spokenLines.push("");
      } else {
        spokenLines.push(line);
      }
      continue;
    }

    const closing = line.match(/^ {0,3}(`{3,4})[ \t]*$/);
    if (closing && closing[1].length >= fenceLength) {
      fenceLength = null;
    }
  }

  return spokenLines.join("\n");
}
