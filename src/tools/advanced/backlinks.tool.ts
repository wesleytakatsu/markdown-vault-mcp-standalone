import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVaultAdvanced } from "./vault-advanced.interface.js";
import { createNoteIndex, linkMatchesTarget } from "../../domain/markdown/link.service.js";

export class BacklinksTool implements ITool {
  readonly definition = {
    name: "markdown_vault_get_backlinks",
    description: "Find markdown files that reference a target note",
    inputSchema: {
      type: "object" as const,
      properties: {
        includeContext: { type: "boolean" },
        path: {
          type: "string",
          description: "Target note path, with or without .md/.markdown",
        },
      },
      required: ["path"],
    },
  };

  constructor(private vault: IVaultAdvanced) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const notePath = String(args.path ?? "");
    const includeContext = args.includeContext !== false;
    const target = await this.vault.resolveMarkdownFile(notePath);
    const notes = await this.vault.loadAllMarkdownNotes();
    const index = createNoteIndex(notes);
    const backlinks: Array<{
      matches: Array<{ line: number; text?: string }>;
      path: string;
    }> = [];

    for (const note of notes) {
      if (note.rel === target.rel) continue;
      const matches = note.links
        .filter((link) =>
          linkMatchesTarget(link, note.rel, target.rel, index),
        )
        .map((link) => ({
          line: link.line,
          ...(includeContext ? { text: link.text } : {}),
        }));
      if (matches.length > 0) backlinks.push({ matches, path: note.rel });
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { backlinks, count: backlinks.length, target: target.rel },
            null,
            2,
          ),
        },
      ],
    };
  }
}
