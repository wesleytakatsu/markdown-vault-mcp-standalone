import path from "node:path";
import type { MarkdownNote } from "../../types/markdown.js";
import { normalizeText } from "../../utils/string.utils.js";
import { MARKDOWN_EXTENSIONS } from "../../config/constants.js";

export class MarkdownFormatter {
  stripMarkdownExtension(value: string): string {
    const ext = path.posix.extname(value);
    return MARKDOWN_EXTENSIONS.has(ext.toLowerCase())
      ? value.slice(0, -ext.length)
      : value;
  }

  firstParagraph(body: string): string {
    const paragraphs = body
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .filter(Boolean);

    for (const paragraph of paragraphs) {
      if (/^#{1,6}\s/.test(paragraph)) continue;
      if (/^```/.test(paragraph)) continue;
      const compact = paragraph.replace(/\s+/g, " ");
      if (compact.length <= 260) return compact;
    }

    return "";
  }

  descriptionFor(note: MarkdownNote): string {
    const description = note.frontmatter.description;
    if (typeof description === "string" && description.trim()) {
      return description.trim();
    }
    return this.firstParagraph(note.body);
  }

  fallbackTitle(note: MarkdownNote): string {
    return (
      note.title ?? path.posix.basename(this.stripMarkdownExtension(note.rel))
    );
  }

  wikilinkBetween(sourceDir: string, destRel: string): string {
    const destNoExt = this.stripMarkdownExtension(destRel);
    const rel = path.posix.relative(
      sourceDir === "." ? "" : sourceDir,
      destNoExt,
    );
    return rel.replace(/^\.\//, "");
  }

  indexLabelFor(
    note: MarkdownNote,
    includeDescription: boolean,
  ): string {
    const title = this.fallbackTitle(note);
    if (!includeDescription) return title;

    const description = this.descriptionFor(note);
    if (!description || this.isSimilarText(title, description)) return title;
    return `${title} — ${description}`;
  }

  headingSlug(value: string): string {
    return normalizeText(value)
      .replace(/&[a-z0-9]+;/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-");
  }

  normalizedHeadingText(value: string): string {
    return normalizeText(value)
      .replace(/[-_]+/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  hasHeadingAnchor(note: MarkdownNote, anchor: string): boolean {
    const wantedSlug = this.headingSlug(anchor);
    const wantedText = this.normalizedHeadingText(anchor);
    return note.headings.some(
      (heading) =>
        this.headingSlug(heading.text) === wantedSlug ||
        this.normalizedHeadingText(heading.text) === wantedText,
    );
  }

  private isSimilarText(left: string, right: string): boolean {
    const normalize = (value: string) =>
      normalizeText(value)
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const a = normalize(left);
    const b = normalize(right);
    if (!a || !b) return false;
    if (a === b) return true;
    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
    return (
      longer.startsWith(shorter) &&
      longer.length <= Math.ceil(shorter.length * 1.25)
    );
  }
}
