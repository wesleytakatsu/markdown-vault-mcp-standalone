import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVaultAdvanced } from "./vault-advanced.interface.js";
import { clampNumber } from "../../utils/validation.utils.js";
import { createNoteIndex, buildGraph } from "../../domain/markdown/link.service.js";
import { rankLoadedNotes } from "../../domain/note/note-ranking.js";

export class FindRelevantNotesTool implements ITool {
  readonly definition = {
    name: "markdown_vault_find_relevant_notes",
    description:
      "Rank notes by agent-oriented heuristic relevance",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: { type: "number" },
        path: { type: "string" },
        query: { type: "string" },
        strategy: {
          type: "string",
          enum: ["hybrid", "literal"],
        },
      },
      required: ["query"],
    },
  };

  constructor(private vault: IVaultAdvanced) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const query = String(args.query ?? "");
    const inputPath =
      typeof args.path === "string" ? args.path : "";
    const limit = clampNumber(args.limit, 10, 1, 50);
    const notes = await this.vault.loadMarkdownNotes(inputPath);
    const index = createNoteIndex(notes);
    const graph = buildGraph(notes, index);
    const ranked = rankLoadedNotes(notes, query, graph, index).slice(
      0,
      limit,
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              query,
              results: ranked.map((entry) => ({
                matchedBy: entry.matchedBy,
                path: entry.note.rel,
                score: entry.score,
                snippet: entry.snippet,
                title: entry.note.title,
              })),
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
