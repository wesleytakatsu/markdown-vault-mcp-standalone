import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { MarkdownNote, Heading } from "../../types/markdown.js";
import type { Frontmatter } from "../../types/frontmatter.js";
import { PathResolver } from "../security/path-resolver.js";
import { MarkdownParser } from "../markdown/markdown.parser.js";
import { HeadingService } from "../markdown/heading.service.js";
import { FrontmatterService } from "../markdown/frontmatter.service.js";
import { LinkService } from "../markdown/link.service.js";
import { TagService } from "../tags/tag.service.js";
import { MarkdownFormatter } from "../markdown/markdown.formatter.js";
import { Sha256MismatchError } from "../../errors/vault-error.js";
import { MARKDOWN_EXTENSIONS } from "../../config/constants.js";

export class NoteService {
  constructor(
    private pathResolver: PathResolver,
    private parser: MarkdownParser,
    private headingService: HeadingService,
    private frontmatterService: FrontmatterService,
    private linkService: LinkService,
    private tagService: TagService,
    private formatter: MarkdownFormatter,
  ) {}

  sha256(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  async fileExists(abs: string): Promise<boolean> {
    try {
      await fsp.access(abs);
      return true;
    } catch {
      return false;
    }
  }

  async assertExpectedSha256(abs: string, expectedSha256?: string): Promise<string | undefined> {
    if (!expectedSha256) return undefined;
    const current = await fsp.readFile(abs, "utf-8");
    const currentSha256 = this.sha256(current);
    if (currentSha256 !== expectedSha256) {
      throw new Sha256MismatchError(expectedSha256, currentSha256);
    }
    return current;
  }

  async readNote(relPath: string): Promise<MarkdownNote> {
    const abs = this.pathResolver.resolveNotePath(relPath);
    await this.pathResolver.assertRealPathInside(abs);
    const stat = await fsp.stat(abs);
    const content = await fsp.readFile(abs, "utf-8");
    const parsed = this.parser.splitFrontmatter(content);
    const headings = this.parser.extractHeadings(content);
    const h1 = headings.find((heading) => heading.level === 1);

    return {
      abs,
      body: parsed.body,
      charCount: content.length,
      content,
      frontmatter: parsed.frontmatter,
      hasFrontmatter: parsed.hasFrontmatter,
      headings,
      lineCount: content.split(/\r?\n/).length,
      links: this.parser.extractLinks(content),
      rawFrontmatter: parsed.rawFrontmatter,
      rel: relPath,
      tags: this.tagService.noteTags(content),
      title: h1?.text ?? null,
      yamlError: parsed.yamlError,
    };
  }

  async readNoteContent(relPath: string): Promise<string> {
    const abs = this.pathResolver.resolveNotePath(relPath);
    await this.pathResolver.assertRealPathInside(abs);
    return fsp.readFile(abs, "utf-8");
  }

  async writeNote(relPath: string, content: string, createDirs = true): Promise<void> {
    const abs = this.pathResolver.resolveNotePath(relPath);
    if (createDirs) await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, "utf-8");
  }

  async deleteNote(relPath: string): Promise<void> {
    const abs = this.pathResolver.resolveNotePath(relPath);
    await this.pathResolver.assertRealPathInside(abs);
    await fsp.unlink(abs);
  }

  async readNoteDetails(relPath: string) {
    const abs = this.pathResolver.resolveNotePath(relPath);
    const stat = await fsp.stat(abs);
    const content = await fsp.readFile(abs, "utf-8");
    const parsed = this.parser.splitFrontmatter(content);
    const headings = this.parser.extractHeadings(parsed.body).map((heading) => ({
      level: heading.level,
      text: heading.text,
      line: heading.line,
    }));

    return {
      content,
      frontmatter: parsed.frontmatter,
      headings,
      links: this.parser.extractLinks(parsed.body).map((link) => link.target).filter((v, i, a) => a.indexOf(v) === i),
      metadata: {
        modified: stat.mtime.toISOString(),
        path: relPath,
        sha256: this.sha256(content),
        size: stat.size,
      },
      tags: this.tagService.noteTags(content),
    };
  }

  async *walkMarkdownFiles(root: string): AsyncGenerator<string> {
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(root);
    } catch (err) {
      if (path.relative(this.pathResolver.root, root) === "") throw err;
      return;
    }

    if (stat.isFile()) {
      if (MARKDOWN_EXTENSIONS.has(path.extname(root).toLowerCase())) yield root;
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch (err) {
      if (path.relative(this.pathResolver.root, root) === "") throw err;
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) {
        yield* this.walkMarkdownFiles(full);
      } else if (
        entry.isFile() &&
        MARKDOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        yield full;
      }
    }
  }
}
