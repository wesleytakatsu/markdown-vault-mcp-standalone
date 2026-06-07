import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVault } from "../../domain/vault/vault.interface.js";
import { PathResolver } from "../../domain/security/path-resolver.js";

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export class WriteFileTool implements ITool {
  readonly definition = {
    name: "write_file",
    description: "Create or overwrite a markdown note; overwrite must be explicit",
    inputSchema: {
      type: "object" as const,
      properties: {
        content: { type: "string", description: "Content to write" },
        createDirs: {
          type: "boolean",
          description: "Create parent directories; defaults to true",
        },
        expectedSha256: {
          type: "string",
          description: "Optional SHA-256 guard for overwrites",
        },
        overwrite: {
          type: "boolean",
          description: "Required to overwrite an existing note",
        },
        path: { type: "string", description: "Markdown file path relative to vault root" },
      },
      required: ["path", "content"],
    },
  };

  constructor(
    private pathResolver: PathResolver,
    private vault: IVault,
  ) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const {
      content,
      createDirs = true,
      expectedSha256,
      overwrite,
      path: notePath,
    } = args as {
      content: string;
      createDirs?: boolean;
      expectedSha256?: string;
      overwrite?: boolean;
      path: string;
    };
    const abs = this.pathResolver.resolveNotePath(notePath);
    const exists = await this.vault.noteExists(notePath);

    if (exists && !overwrite) {
      throw new Error(
        "Target file already exists. Use another path or pass overwrite: true to replace it.",
      );
    }
    if (exists && expectedSha256) {
      const current = await this.vault.readNoteContent(notePath);
      const currentSha256 = sha256(current);
      if (currentSha256 !== expectedSha256) {
        throw new Error(
          `SHA-256 mismatch: expected ${expectedSha256}, got ${currentSha256}`,
        );
      }
    }
    if (createDirs) await fsp.mkdir(path.dirname(abs), { recursive: true });

    await this.vault.writeNote(notePath, content);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              overwritten: exists,
              path: notePath,
              sha256: sha256(content),
              size: Buffer.byteLength(content, "utf-8"),
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
