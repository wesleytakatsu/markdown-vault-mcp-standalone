import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVaultAdvanced } from "./vault-advanced.interface.js";
import { createNoteIndex, buildGraph } from "../../domain/markdown/link.service.js";

export class ImpactAnalysisTool implements ITool {
  readonly definition = {
    name: "markdown_vault_impact_analysis",
    description:
      "Analyze a note before moving, renaming, or deleting it",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Note path to analyze" },
      },
      required: ["path"],
    },
  };

  constructor(private vault: IVaultAdvanced) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const notePath = String(args.path ?? "");
    const target = await this.vault.resolveMarkdownFile(notePath);

    if (!target.exists) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                backlinks: [],
                exists: false,
                frontmatter: {},
                outgoingLinks: [],
                path: target.rel,
                risks: ["This note does not exist."],
                tags: [],
                title: null,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    const notes = await this.vault.loadAllMarkdownNotes();
    const index = createNoteIndex(notes);
    const graph = buildGraph(notes, index);
    const note = index.byRel.get(target.rel);
    if (!note) {
      throw new Error(`File not found inside vault: ${notePath}`);
    }

    const backlinks = [
      ...(graph.backlinks.get(note.rel)?.keys() ?? []),
    ].sort();
    const outgoingLinks = [
      ...(graph.outgoing.get(note.rel) ?? new Set<string>()),
    ].sort();
    const risks: string[] = [];
    if (backlinks.length > 0) {
      risks.push(
        `This note is referenced by ${backlinks.length} files.`,
      );
      risks.push("Deleting or moving it may break links.");
    }
    if (outgoingLinks.length > 0) {
      risks.push(
        `This note points to ${outgoingLinks.length} internal notes.`,
      );
    }
    if (!note.title) risks.push("This note has no H1 title.");

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              backlinks,
              exists: true,
              frontmatter: note.frontmatter,
              outgoingLinks,
              path: note.rel,
              risks,
              tags: note.tags,
              title: note.title,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
