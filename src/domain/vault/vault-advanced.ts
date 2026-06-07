import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import type { MarkdownNote } from "../../types/markdown.js";
import type { IVaultAdvanced } from "../../tools/advanced/vault-advanced.interface.js";
import { PathResolver } from "../security/path-resolver.js";
import { MarkdownParser } from "../markdown/markdown.parser.js";
import { LinkService } from "../markdown/link.service.js";
import { MarkdownFormatter } from "../markdown/markdown.formatter.js";
import { TagService } from "../tags/tag.service.js";
import { MARKDOWN_EXTENSIONS, IGNORED_DIRS } from "../../config/constants.js";
import { isMarkdownPath } from "../../utils/validation.utils.js";

const NOTE_CACHE = new Map<
  string,
  { mtimeMs: number; note: MarkdownNote; size: number }
>();

export class VaultAdvanced implements IVaultAdvanced {
  constructor(
    public readonly pathResolver: PathResolver,
    public readonly parser: MarkdownParser,
    public readonly linkService: LinkService,
    public readonly formatter: MarkdownFormatter,
    public readonly tagService: TagService,
  ) {}

  get root(): string {
    return this.pathResolver.root;
  }

  get realRoot(): string {
    return this.pathResolver.realRoot;
  }

  resolveVaultPath(input?: string): Promise<string> {
    return Promise.resolve(this.pathResolver.resolveVaultPath(input));
  }

  relativePath(abs: string): string {
    return this.pathResolver.relativePath(abs);
  }

  async fileExists(abs: string): Promise<boolean> {
    try {
      await fsp.access(abs);
      return true;
    } catch {
      return false;
    }
  }

  async resolveMarkdownFile(
    input: string,
    options: { mustExist?: boolean } = {},
  ): Promise<{ abs: string; exists: boolean; rel: string }> {
    if (!input || typeof input !== "string") {
      throw new Error("path is required");
    }

    const normalizedInput = input.replace(/\\/g, "/");
    const ext = path.posix.extname(normalizedInput).toLowerCase();
    if (ext && !MARKDOWN_EXTENSIONS.has(ext)) {
      throw new Error("Only .md and .markdown note files are supported");
    }

    const candidates = ext
      ? [normalizedInput]
      : [`${normalizedInput}.md`, `${normalizedInput}.markdown`];

    for (const candidate of candidates) {
      const abs = this.pathResolver.resolveVaultPath(candidate);
      const exists = await this.fileExists(abs);
      if (!exists) continue;
      return { abs, exists: true, rel: this.relativePath(abs) };
    }

    if (options.mustExist) {
      throw new Error(`File not found inside vault: ${input}`);
    }

    const fallback = candidates[0];
    const abs = this.pathResolver.resolveVaultPath(fallback);
    return { abs, exists: false, rel: this.relativePath(abs) };
  }

  async listMarkdownFileRefs(
    inputPath = "",
  ): Promise<Array<{ abs: string; rel: string }>> {
    const rootAbs = this.pathResolver.resolveVaultPath(inputPath);
    const stat = await this.lstatMaybe(rootAbs);
    if (!stat) throw new Error(`Path not found: ${inputPath || "."}`);
    if (stat.isFile() && !isMarkdownPath(rootAbs, MARKDOWN_EXTENSIONS)) {
      throw new Error("Only .md and .markdown note files are supported");
    }

    const files: Array<{ abs: string; rel: string }> = [];
    for await (const abs of this.walkMarkdownFiles(rootAbs)) {
      files.push({ abs, rel: this.relativePath(abs) });
    }
    return files.sort((a, b) => a.rel.localeCompare(b.rel));
  }

  async loadMarkdownNotes(inputPath = ""): Promise<MarkdownNote[]> {
    const refs = await this.listMarkdownFileRefs(inputPath);
    return Promise.all(refs.map((ref) => this.loadMarkdownNote(ref)));
  }

  async loadAllMarkdownNotes(): Promise<MarkdownNote[]> {
    return this.loadMarkdownNotes("");
  }

  async readFile(abs: string): Promise<string> {
    await this.pathResolver.assertRealPathInside(abs);
    return fsp.readFile(abs, "utf-8");
  }

  async writeFile(abs: string, content: string): Promise<void> {
    await this.pathResolver.assertRealPathInside(abs);
    await fsp.writeFile(abs, content, "utf-8");
  }

  async mkdir(abs: string): Promise<void> {
    await fsp.mkdir(abs, { recursive: true });
  }

  async rename(fromAbs: string, toAbs: string): Promise<void> {
    await fsp.rename(fromAbs, toAbs);
  }

  private async lstatMaybe(abs: string): Promise<fs.Stats | undefined> {
    try {
      return await fsp.lstat(abs);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return undefined;
      throw err;
    }
  }

  private async *walkMarkdownFiles(rootAbs: string): AsyncGenerator<string> {
    const stat = await this.lstatMaybe(rootAbs);
    if (!stat) return;
    if (stat.isSymbolicLink()) return;

    if (stat.isFile()) {
      if (isMarkdownPath(rootAbs, MARKDOWN_EXTENSIONS)) yield rootAbs;
      return;
    }

    if (!stat.isDirectory()) return;

    const entries = await fsp.readdir(rootAbs, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(rootAbs, entry.name);
      if (entry.isDirectory()) {
        yield* this.walkMarkdownFiles(full);
      } else if (entry.isFile() && isMarkdownPath(entry.name, MARKDOWN_EXTENSIONS)) {
        await this.pathResolver.assertRealPathInside(full);
        yield full;
      }
    }
  }

  private async loadMarkdownNote(
    ref: { abs: string; rel: string },
  ): Promise<MarkdownNote> {
    await this.pathResolver.assertRealPathInside(ref.abs);
    const stat = await fsp.stat(ref.abs);
    const cacheKey = `${this.pathResolver.realRoot}:${ref.rel}`;
    const cached = NOTE_CACHE.get(cacheKey);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.note;
    }

    const content = await fsp.readFile(ref.abs, "utf-8");
    const parsed = this.parser.splitFrontmatter(content);
    const headings = this.parser.extractHeadings(content);
    const h1 = headings.find((heading) => heading.level === 1);

    const note: MarkdownNote = {
      abs: ref.abs,
      body: parsed.body,
      charCount: content.length,
      content,
      frontmatter: parsed.frontmatter,
      hasFrontmatter: parsed.hasFrontmatter,
      headings,
      lineCount: content.split(/\r?\n/).length,
      links: this.parser.extractLinks(content),
      rawFrontmatter: parsed.rawFrontmatter,
      rel: ref.rel,
      tags: this.tagService.noteTags(content),
      title: h1?.text ?? null,
      yamlError: parsed.yamlError,
    };
    NOTE_CACHE.set(cacheKey, { mtimeMs: stat.mtimeMs, note, size: stat.size });
    return note;
  }
}
