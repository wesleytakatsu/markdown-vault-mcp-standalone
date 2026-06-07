import crypto from "node:crypto";
import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVault } from "../../domain/vault/vault.interface.js";
import { PathResolver } from "../../domain/security/path-resolver.js";

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export class ReadFileTool implements ITool {
  readonly definition = {
    name: "read_file",
    description: "Read a markdown note as content, metadata, outline, or full JSON",
    inputSchema: {
      type: "object" as const,
      properties: {
        format: {
          type: "string",
          enum: ["content", "metadata", "outline", "full"],
          description: "Response shape; defaults to content",
        },
        path: {
          type: "string",
          description: "Markdown file path relative to vault root (e.g. index.md)",
        },
      },
      required: ["path"],
    },
  };

  constructor(
    private pathResolver: PathResolver,
    private vault: IVault,
  ) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { format = "content", path: notePath } = args as {
      format?: "content" | "metadata" | "outline" | "full";
      path: string;
    };
    const note = await this.vault.readNote(notePath);

    if (format === "content") {
      return { content: [{ type: "text", text: note.content }] };
    }
    if (format === "metadata") {
      const { content: _, ...rest } = note;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ...rest,
                metadata: {
                  path: notePath,
                  sha256: sha256(note.content),
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    }
    if (format === "outline") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ headings: note.headings }, null, 2),
          },
        ],
      };
    }
    return {
      content: [
        { type: "text", text: JSON.stringify(note, null, 2) },
      ],
    };
  }
}
