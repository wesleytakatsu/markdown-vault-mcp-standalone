import fsp from "node:fs/promises";
import { JSON_MIME } from "../config/constants.js";
import type { IResourceHandler } from "./resource-handler.js";
import type { IVault } from "../domain/vault/vault.interface.js";
import { PathResolver } from "../domain/security/path-resolver.js";
import { NoteService } from "../domain/note/note.service.js";

export class VaultResource implements IResourceHandler {
  readonly uriPattern = "markdown-vault://vault/{path}";

  constructor(
    private vault: IVault,
    private pathResolver: PathResolver,
    private noteService: NoteService,
  ) {}

  async list(): Promise<Array<{
    description: string;
    mimeType: string;
    name: string;
    size?: number;
    uri: string;
  }>> {
    const files = await this.vault.listNotes();
    const resources: Awaited<ReturnType<VaultResource["list"]>> = [];
    for (const relPath of files) {
      const abs = this.pathResolver.resolveNotePath(relPath);
      try {
        const fileStat = await fsp.stat(abs);
        resources.push({
          description: `Markdown note: ${relPath}`,
          mimeType: JSON_MIME,
          name: relPath,
          uri: this.noteUri(relPath),
          size: fileStat.size,
        });
      } catch {
      }
    }
    return resources;
  }

  async read(uri: string): Promise<{
    contents: Array<{
      mimeType: string;
      text: string;
      uri: string;
    }>;
  }> {
    const relPath = this.pathFromNoteUri(uri);
    const details = await this.noteService.readNoteDetails(relPath);
    return {
      contents: [
        {
          mimeType: JSON_MIME,
          text: JSON.stringify(details, null, 2),
          uri,
        },
      ],
    };
  }

  noteUri(relPath: string): string {
    return `markdown-vault://vault/${relPath
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")}`;
  }

  pathFromNoteUri(uri: string): string {
    const parsed = new URL(uri);
    if (parsed.protocol !== "markdown-vault:" || parsed.hostname !== "vault") {
      throw new Error(`Unsupported resource URI: ${uri}`);
    }
    return parsed.pathname
      .replace(/^\//, "")
      .split("/")
      .map((part) => decodeURIComponent(part))
      .join("/");
  }
}
