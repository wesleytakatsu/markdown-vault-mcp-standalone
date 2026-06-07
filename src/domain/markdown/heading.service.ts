import type { Heading } from "../../types/markdown.js";
import {
  normalizeHeading,
  ensureTrailingNewline,
  splitLinesWithEndings,
  stripLineEnding,
} from "../../utils/string.utils.js";
import type { MarkdownParser } from "./markdown.parser.js";

type HeadingWithOffsets = Heading & {
  startOffset: number;
  contentStartOffset: number;
  endOffset: number;
};

export class HeadingService {
  constructor(private parser: MarkdownParser) {}

  getHeadings(content: string): Heading[] {
    return this.parser.extractHeadings(content);
  }

  findHeading(content: string, heading: string): Heading | undefined {
    const wanted = normalizeHeading(heading);
    const headings = this.parser.extractHeadings(content);
    return headings.find(
      (candidate) => normalizeHeading(candidate.text) === wanted,
    );
  }

  sectionContent(
    content: string,
    heading: string,
    includeHeading = true,
  ): { endOffset: number; section: string; startOffset: number; target: HeadingWithOffsets } {
    const target = this.findHeading(content, heading);
    if (!target) throw new Error(`Heading not found: ${heading}`);

    const headings = this.getHeadingsWithOffsets(content);
    const fullTarget = headings.find(
      (h) => h.level === target.level && h.line === target.line,
    );
    if (!fullTarget) throw new Error(`Heading not found: ${heading}`);

    const start = includeHeading ? fullTarget.startOffset : fullTarget.contentStartOffset;
    return {
      endOffset: fullTarget.endOffset,
      section: content.slice(start, fullTarget.endOffset),
      startOffset: start,
      target: fullTarget,
    };
  }

  deleteSection(
    content: string,
    heading: string,
    includeHeading = true,
  ): { next: string; removed: string; target: HeadingWithOffsets } {
    const section = this.sectionContent(content, heading, includeHeading);
    const prefix = content.slice(0, section.startOffset).trimEnd();
    const suffix = content.slice(section.endOffset).replace(/^\s*/, "");
    const separator = prefix && suffix ? "\n\n" : "";
    return {
      next: `${prefix}${separator}${suffix}`,
      removed: section.section,
      target: section.target,
    };
  }

  appendSection(
    content: string,
    heading: string,
    patchContent: string,
    createHeading = false,
    headingLevel = 2,
  ): string {
    const target = this.findHeading(content, heading);
    if (!target) {
      if (createHeading) {
        return this.appendHeadingSection(content, heading, headingLevel, patchContent);
      }
      throw new Error(`Heading not found: ${heading}`);
    }

    const headings = this.getHeadingsWithOffsets(content);
    const fullTarget = headings.find(
      (h) => h.level === target.level && h.line === target.line,
    )!;
    const before = content.slice(0, fullTarget.endOffset).trimEnd();
    const suffix = content.slice(fullTarget.endOffset);
    const insertion = `\n\n${ensureTrailingNewline(patchContent.trimEnd())}`;
    return `${before}${insertion}${suffix}`;
  }

  prependSection(
    content: string,
    heading: string,
    patchContent: string,
  ): string {
    const target = this.findHeading(content, heading);
    if (!target) throw new Error(`Heading not found: ${heading}`);

    const headings = this.getHeadingsWithOffsets(content);
    const fullTarget = headings.find(
      (h) => h.level === target.level && h.line === target.line,
    )!;
    const prefix = ensureTrailingNewline(
      content.slice(0, fullTarget.contentStartOffset),
    );
    const suffix = content
      .slice(fullTarget.contentStartOffset)
      .replace(/^\s*/, "");
    const insertion = `${ensureTrailingNewline(patchContent.trimEnd())}\n`;
    return `${prefix}${insertion}${suffix}`;
  }

  replaceSection(
    content: string,
    heading: string,
    patchContent: string,
    createHeading = false,
    headingLevel = 2,
  ): string {
    const target = this.findHeading(content, heading);
    if (!target) {
      if (createHeading) {
        return this.appendHeadingSection(content, heading, headingLevel, patchContent);
      }
      throw new Error(`Heading not found: ${heading}`);
    }

    const headings = this.getHeadingsWithOffsets(content);
    const fullTarget = headings.find(
      (h) => h.level === target.level && h.line === target.line,
    )!;
    const prefix = ensureTrailingNewline(
      content.slice(0, fullTarget.contentStartOffset),
    );
    const suffix = content.slice(fullTarget.endOffset);
    const replacement = ensureTrailingNewline(patchContent.trimEnd());
    return `${prefix}${replacement}${suffix}`;
  }

  private appendHeadingSection(
    content: string,
    heading: string,
    headingLevel: number,
    patchContent: string,
  ): string {
    const prefix = content.trimEnd();
    const hashes = "#".repeat(Math.min(Math.max(headingLevel, 1), 6));
    const section = `${hashes} ${heading.trim()}\n${ensureTrailingNewline(
      patchContent.trimEnd(),
    )}`;
    return prefix ? `${prefix}\n\n${section}` : section;
  }

  getHeadingsWithOffsets(content: string): HeadingWithOffsets[] {
    const lines = splitLinesWithEndings(content);
    const headings: HeadingWithOffsets[] = [];
    let offset = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const text = stripLineEnding(line);
      const match = text.match(/^(#{1,6})\s+(.+?)\s*#*$/);
      if (match) {
        headings.push({
          level: match[1].length,
          text: match[2].trim(),
          line: i + 1,
          startOffset: offset,
          contentStartOffset: offset + line.length,
          endOffset: content.length,
        });
      }
      offset += line.length;
    }

    for (let i = 0; i < headings.length; i++) {
      const current = headings[i];
      const next = headings
        .slice(i + 1)
        .find((candidate) => candidate.level <= current.level);
      current.endOffset = next?.startOffset ?? content.length;
    }

    return headings;
  }
}
