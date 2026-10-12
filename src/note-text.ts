/** Readable body of a note. Leading YAML frontmatter is not spoken. */
export function narrationText(markdown: string): string {
  const withoutFrontmatter = markdown.replace(
    /^---\r?\n[\s\S]*?\r?\n---\r?\n?/,
    "",
  );
  return withoutFrontmatter.trim();
}
