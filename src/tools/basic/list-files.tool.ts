import fsp from "node:fs/promises";
import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVault } from "../../domain/vault/vault.interface.js";
import { PathResolver } from "../../domain/security/path-resolver.js";

export class ListFilesTool implements ITool {
  readonly definition = {
    name: "list_files",
    description: "List markdown files in the vault",
    inputSchema: {
      type: "object" as const,
      properties: {
        includeMetadata: {
          type: "boolean",
          description: "Return size and modification time as JSON",
        },
        path: {
          type: "string",
          description: "Optional subdirectory or markdown file relative to vault root",
        },
      },
    },
  };

  constructor(
    private pathResolver: PathResolver,
    private vault: IVault,
  ) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { includeMetadata, path: subPath = "" } = args as {
      includeMetadata?: boolean;
      path?: string;
    };
    const root = this.pathResolver.resolveVaultPath(subPath);
    const relFiles = await this.vault.listNotes(
      subPath || undefined,
    );

    if (!includeMetadata) {
      return { content: [{ type: "text", text: relFiles.join("\n") }] };
    }

    const entries = await Promise.all(
      relFiles.map(async (file) => {
        const abs = this.pathResolver.resolveNotePath(file);
        const stat = await fsp.stat(abs);
        return {
          modified: stat.mtime.toISOString(),
          path: file,
          size: stat.size,
        };
      }),
    );
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ files: entries }, null, 2),
        },
      ],
    };
  }
}
