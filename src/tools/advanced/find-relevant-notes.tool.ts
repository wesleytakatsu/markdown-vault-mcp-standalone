import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVaultAdvanced } from "./vault-advanced.interface.js";
import { clampNumber } from "../../utils/validation.utils.js";
import { createNoteIndex, buildGraph } from "../../domain/markdown/link.service.js";
import { rankLoadedNotes, type RankOptions } from "../../domain/note/note-ranking.js";
import { loadProjectSynonyms, type SynonymMode } from "../../domain/note/synonym.service.js";

const SYNONYM_MODES: SynonymMode[] = ["off", "basic", "project"];

function parseSynonymMode(value: unknown): SynonymMode {
  return typeof value === "string" && (SYNONYM_MODES as string[]).includes(value)
    ? (value as SynonymMode)
    : "off";
}

export async function buildRankOptions(
  vault: IVaultAdvanced,
  args: Record<string, unknown>,
): Promise<{ options: RankOptions; warnings: string[] }> {
  const fuzzy = args.fuzzy === true;
  const synonymMode = parseSynonymMode(args.synonymMode);
  const maxFuzzyDistance =
    typeof args.maxFuzzyDistance === "number" && Number.isFinite(args.maxFuzzyDistance)
      ? args.maxFuzzyDistance
      : undefined;

  const warnings: string[] = [];
  let projectSynonyms = null;
  if (synonymMode === "project") {
    const result = await loadProjectSynonyms(vault);
    projectSynonyms = result.dict;
    if (result.warning) warnings.push(result.warning);
  }

  return {
    options: { fuzzy, maxFuzzyDistance, synonymMode, projectSynonyms },
    warnings,
  };
}

export class FindRelevantNotesTool implements ITool {
  readonly definition = {
    name: "markdown_vault_find_relevant_notes",
    description:
      "Rank notes by agent-oriented heuristic relevance",
    inputSchema: {
      type: "object" as const,
      properties: {
        fuzzy: { type: "boolean" },
        limit: { type: "number" },
        maxFuzzyDistance: { type: "number" },
        path: { type: "string" },
        query: { type: "string" },
        strategy: {
          type: "string",
          enum: ["hybrid", "literal"],
        },
        synonymMode: { type: "string", enum: SYNONYM_MODES },
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
    const { options, warnings } = await buildRankOptions(this.vault, args);
    const notes = await this.vault.loadMarkdownNotes(inputPath);
    const index = createNoteIndex(notes);
    const graph = buildGraph(notes, index);
    const ranked = rankLoadedNotes(notes, query, graph, index, options).slice(
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
              ...(warnings.length > 0 ? { warnings } : {}),
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
