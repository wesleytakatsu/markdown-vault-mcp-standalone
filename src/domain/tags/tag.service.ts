import { normalizeTags, escapeRegExp } from "../../utils/string.utils.js";
import type { Frontmatter } from "../../types/frontmatter.js";
import type { MarkdownParser } from "../markdown/markdown.parser.js";

export class TagService {
  constructor(private parser: MarkdownParser) {}

  frontmatterTags(frontmatter: Frontmatter): string[] {
    const value = frontmatter.tags;
    if (Array.isArray(value)) {
      return normalizeTags(
        value
          .filter((item): item is string => typeof item === "string")
          .flatMap((item) => item.split(/[\s,]+/)),
      );
    }
    if (typeof value === "string") {
      return normalizeTags(value.split(/[\s,]+/));
    }
    return [];
  }

  inlineTags(body: string): string[] {
    const tags: string[] = [];
    const re = /(^|[\s([{])#([A-Za-z0-9_/-]+)\b/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(body)) !== null) tags.push(match[2]);
    return normalizeTags(tags);
  }

  noteTags(content: string): string[] {
    const parsed = this.parser.splitFrontmatter(content);
    return normalizeTags([
      ...this.frontmatterTags(parsed.frontmatter),
      ...this.inlineTags(parsed.body),
    ]);
  }

  removeInlineTagsFromBody(body: string, tagsToRemove: string[]): string {
    let next = body;
    for (const tag of normalizeTags(tagsToRemove)) {
      const re = new RegExp(`(^|[\\s([{])#${escapeRegExp(tag)}\\b`, "gm");
      next = next.replace(re, "$1");
    }
    return next.replace(/[ \t]{2,}/g, " ");
  }
}
