import type { Frontmatter } from "../../types/frontmatter.js";
import { formatYamlScalar } from "../../utils/parsing.utils.js";
import { normalizeTags } from "../../utils/string.utils.js";
import type { MarkdownParser } from "./markdown.parser.js";

export class FrontmatterService {
  constructor(private parser: MarkdownParser) {}

  extract(content: string): Frontmatter {
    return this.parser.splitFrontmatter(content).frontmatter;
  }

  update(content: string, updates: Partial<Frontmatter>): string {
    const parsed = this.parser.splitFrontmatter(content);
    const next: Frontmatter = { ...parsed.frontmatter };
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) {
        delete next[key];
      } else {
        next[key] = value;
      }
    }
    const serialized = this.serialize(next);
    if (!serialized) return parsed.body;
    return `${serialized}${parsed.body}`;
  }

  serialize(frontmatter: Frontmatter): string {
    const keys = Object.keys(frontmatter).filter(
      (key) => frontmatter[key] !== undefined,
    );
    if (keys.length === 0) return "";

    const lines: string[] = [];
    for (const key of keys) {
      const value = frontmatter[key];
      if (Array.isArray(value)) {
        if (value.length === 0) {
          lines.push(`${key}: []`);
        } else {
          lines.push(`${key}:`);
          for (const item of value) {
            lines.push(`  - ${formatYamlScalar(item)}`);
          }
        }
      } else {
        lines.push(`${key}: ${formatYamlScalar(value)}`);
      }
    }

    return `---\n${lines.join("\n")}\n---\n`;
  }

  tags(frontmatter: Frontmatter): string[] {
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

  replaceFrontmatter(content: string, frontmatter: Frontmatter): string {
    const parsed = this.parser.splitFrontmatter(content);
    const serialized = this.serialize(frontmatter);
    if (!serialized) return parsed.body;
    return `${serialized}${parsed.body}`;
  }
}
