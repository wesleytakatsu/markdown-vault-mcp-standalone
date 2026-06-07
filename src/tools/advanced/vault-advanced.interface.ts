import type { MarkdownNote } from "../../types/markdown.js";

export interface IVaultAdvanced {
  readonly root: string;
  readonly realRoot: string;
  resolveMarkdownFile(
    input: string,
    options?: { mustExist?: boolean },
  ): Promise<{ abs: string; exists: boolean; rel: string }>;
  loadMarkdownNotes(inputPath?: string): Promise<MarkdownNote[]>;
  loadAllMarkdownNotes(): Promise<MarkdownNote[]>;
  listMarkdownFileRefs(
    inputPath?: string,
  ): Promise<Array<{ abs: string; rel: string }>>;
  readFile(abs: string): Promise<string>;
  writeFile(abs: string, content: string): Promise<void>;
  mkdir(abs: string): Promise<void>;
  fileExists(abs: string): Promise<boolean>;
  rename(fromAbs: string, toAbs: string): Promise<void>;
  resolveVaultPath(input?: string): Promise<string>;
  relativePath(abs: string): string;
}
