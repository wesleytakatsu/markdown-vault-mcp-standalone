import type { MarkdownNote } from "../../types/markdown.js";
import type { Frontmatter } from "../../types/frontmatter.js";

export interface SearchOptions {
  caseSensitive?: boolean;
  regex?: boolean;
  wholeWord?: boolean;
}

export interface SearchResult {
  context: string;
  line: number;
  path: string;
  text: string;
}

export interface IVault {
  readonly root: string;
  readonly realRoot: string;

  listNotes(subPath?: string): Promise<string[]>;
  noteExists(relPath: string): Promise<boolean>;
  readNote(relPath: string): Promise<MarkdownNote>;
  readNoteContent(relPath: string): Promise<string>;
  writeNote(relPath: string, content: string): Promise<void>;
  deleteNote(relPath: string): Promise<void>;
  searchNotes(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}
