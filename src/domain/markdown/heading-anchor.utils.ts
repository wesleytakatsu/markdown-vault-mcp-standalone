import type { MarkdownNote } from "../../types/markdown.js";
import { normalizeText } from "../../utils/string.utils.js";

export function headingSlug(value: string): string {
  return normalizeText(value)
    .replace(/&[a-z0-9]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function normalizedHeadingText(value: string): string {
  return normalizeText(value)
    .replace(/[-_]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasHeadingAnchor(note: MarkdownNote, anchor: string): boolean {
  const wantedSlug = headingSlug(anchor);
  const wantedText = normalizedHeadingText(anchor);
  return note.headings.some(
    (heading) =>
      headingSlug(heading.text) === wantedSlug ||
      normalizedHeadingText(heading.text) === wantedText,
  );
}
