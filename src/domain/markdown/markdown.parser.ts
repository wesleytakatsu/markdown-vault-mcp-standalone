import { parseScalar } from "../../utils/parsing.utils.js";
import type { JsonValue } from "../../types/common.js";
import type { Frontmatter } from "../../types/frontmatter.js";
import type { FrontmatterParse } from "../../types/frontmatter.js";
import type { Heading, LinkMatch } from "../../types/markdown.js";

export class MarkdownParser {
  parseFrontmatter(raw: string): Frontmatter {
    const result: Frontmatter = {};
    const lines = raw.split(/\r?\n/);

    for (let i = 0; i < lines.length; i += 1) {
      const match = lines[i].match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
      if (!match) continue;

      const [, key, value = ""] = match;
      if (value.trim()) {
        result[key] = parseScalar(value);
        continue;
      }

      const items: JsonValue[] = [];
      let cursor = i + 1;
      while (cursor < lines.length) {
        const itemMatch = lines[cursor].match(/^\s*-\s+(.*)$/);
        if (!itemMatch) break;
        items.push(parseScalar(itemMatch[1]));
        cursor += 1;
      }

      if (items.length > 0) {
        result[key] = items;
        i = cursor - 1;
      } else {
        result[key] = "";
      }
    }

    return result;
  }

  splitFrontmatter(content: string): FrontmatterParse {
    if (!content.startsWith("---")) {
      return {
        body: content,
        frontmatter: {},
        hasFrontmatter: false,
        rawFrontmatter: "",
      };
    }

    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) {
      return {
        body: content,
        frontmatter: {},
        hasFrontmatter: true,
        rawFrontmatter: content.replace(/^---\r?\n?/, ""),
        yamlError: "Unclosed frontmatter block",
      };
    }

    const yamlError = this.validateSimpleYaml(match[1]);
    return {
      body: content.slice(match[0].length),
      frontmatter: this.parseFrontmatter(match[1]),
      hasFrontmatter: true,
      rawFrontmatter: match[1],
      yamlError,
    };
  }

  extractHeadings(content: string): Heading[] {
    const lines = content.split(/\r?\n/);
    const headings: Heading[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      const match = lines[i].match(/^(#{1,6})\s+(.+?)\s*#*$/);
      if (!match) continue;
      headings.push({
        level: match[1].length,
        line: i + 1,
        text: match[2].trim(),
      });
    }

    return headings;
  }

  extractLinks(content: string): LinkMatch[] {
    const links: LinkMatch[] = [];
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      let wikiMatch: RegExpExecArray | null;
      const wikiRe = /\[\[([^\]\n]+)\]\]/g;
      while ((wikiMatch = wikiRe.exec(line)) !== null) {
        const parsed = this.splitWikiTarget(wikiMatch[1]);
        links.push({
          alias: parsed.alias,
          line: i + 1,
          raw: wikiMatch[0],
          target: parsed.pathPart,
          text: line,
          type: "wikilink",
        });
      }

      let mdMatch: RegExpExecArray | null;
      const mdRe = /(!?)\[([^\]\n]*)\]\(([^)\n]+)\)/g;
      while ((mdMatch = mdRe.exec(line)) !== null) {
        if (mdMatch[1] === "!") continue;
        const href = this.stripLinkDecorations(mdMatch[3]);
        if (this.isExternalLink(href) || href.startsWith("#")) continue;
        links.push({
          href,
          line: i + 1,
          raw: mdMatch[0],
          target: href,
          text: line,
          type: "markdown",
        });
      }
    }

    return links;
  }

  private validateSimpleYaml(raw: string): string | undefined {
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      if (/^\s/.test(line)) continue;
      if (!/^[A-Za-z0-9_-]+:(?:\s+.*)?$/.test(line)) {
        return `Invalid frontmatter line ${i + 1}: ${line}`;
      }
    }
    return undefined;
  }

  private splitWikiTarget(value: string): { alias?: string; pathPart: string } {
    const [target, alias] = value.split("|", 2);
    return {
      alias: alias?.trim(),
      pathPart: target.trim(),
    };
  }

  private stripLinkDecorations(target: string): string {
    let next = target.trim();
    if (next.startsWith("<") && next.endsWith(">")) next = next.slice(1, -1);
    next = next.replace(/\s+["'][^"']*["']$/, "");
    try {
      next = decodeURI(next);
    } catch {
      return next;
    }
    return next;
  }

  private isExternalLink(target: string): boolean {
    return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target);
  }

  private removeAnchorAndQuery(target: string): string {
    const hashIndex = target.indexOf("#");
    const queryIndex = target.indexOf("?");
    const cut = [hashIndex, queryIndex]
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0];
    return cut === undefined ? target : target.slice(0, cut);
  }
}
