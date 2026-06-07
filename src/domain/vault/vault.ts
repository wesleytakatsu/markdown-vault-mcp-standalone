import fsp from "node:fs/promises";
import path from "node:path";
import type { MarkdownNote } from "../../types/markdown.js";
import type { IVault, SearchOptions, SearchResult } from "./vault.interface.js";
import { PathResolver } from "../security/path-resolver.js";
import { NoteService } from "../note/note.service.js";
import { MarkdownParser } from "../markdown/markdown.parser.js";
import { MarkdownFormatter } from "../markdown/markdown.formatter.js";
import { NoteNotFoundError } from "../../errors/vault-error.js";
import { escapeRegExp, trimToChars } from "../../utils/string.utils.js";

export class Vault implements IVault {
  constructor(
    private pathResolver: PathResolver,
    private noteService: NoteService,
    private parser: MarkdownParser,
    private formatter: MarkdownFormatter,
  ) {}

  get root(): string {
    return this.pathResolver.root;
  }

  get realRoot(): string {
    return this.pathResolver.realRoot;
  }

  async listNotes(subPath = ""): Promise<string[]> {
    const root = this.pathResolver.resolveVaultPath(subPath);
    const files: string[] = [];
    for await (const file of this.noteService.walkMarkdownFiles(root)) {
      files.push(this.pathResolver.relativePath(file));
    }
    return files.sort();
  }

  async noteExists(relPath: string): Promise<boolean> {
    const abs = this.pathResolver.resolveNotePath(relPath);
    return this.noteService.fileExists(abs);
  }

  async readNote(relPath: string): Promise<MarkdownNote> {
    return this.noteService.readNote(relPath);
  }

  async readNoteContent(relPath: string): Promise<string> {
    return this.noteService.readNoteContent(relPath);
  }

  async writeNote(relPath: string, content: string, createDirs = true): Promise<void> {
    await this.noteService.writeNote(relPath, content, createDirs);
  }

  async deleteNote(relPath: string): Promise<void> {
    await this.noteService.deleteNote(relPath);
  }

  async searchNotes(
    query: string,
    options: SearchOptions = {},
  ): Promise<SearchResult[]> {
    const source = options.regex ? query : escapeRegExp(query);
    const bounded = options.wholeWord ? `\\b${source}\\b` : source;
    const flags = options.caseSensitive ? "g" : "gi";
    const re = new RegExp(bounded, flags);
    const root = this.pathResolver.resolveVaultPath("");
    const results: SearchResult[] = [];

    for await (const file of this.noteService.walkMarkdownFiles(root)) {
      const content = await fsp.readFile(file, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        re.lastIndex = 0;
        if (!re.test(lines[i])) continue;
        results.push({
          context: lines.slice(Math.max(0, i - 1), i + 2).join("\n"),
          line: i + 1,
          path: this.pathResolver.relativePath(file),
          text: lines[i],
        });
      }
    }
    return results;
  }
}
