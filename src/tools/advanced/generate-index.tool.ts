import path from "node:path";
import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVaultAdvanced } from "./vault-advanced.interface.js";
import type { MarkdownNote } from "../../types/markdown.js";
import { trimToChars } from "../../utils/string.utils.js";
import { wikilinkBetween } from "../../domain/markdown/link.service.js";
import { indexLabelFor } from "../../domain/note/note-ranking.js";

function buildIndexContent(
  notes: MarkdownNote[],
  targetRel: string,
  baseRel: string,
  options: { includeDescriptions: boolean; mode: "flat" | "hierarchical" },
): string {
  const title = "# Índice da documentação";
  const targetDir = path.posix.dirname(targetRel);
  const sorted = [...notes].sort((a, b) => a.rel.localeCompare(b.rel));
  const itemFor = (note: MarkdownNote) => {
    const link = wikilinkBetween(targetDir, note.rel);
    const label = indexLabelFor(note, options.includeDescriptions);
    return label ? `- [[${link}]] — ${label}` : `- [[${link}]]`;
  };

  if (options.mode === "flat") {
    return `${title}\n\n${sorted.map(itemFor).join("\n")}\n`;
  }

  const groups = new Map<string, MarkdownNote[]>();
  const normalizedBase = baseRel === "" ? "" : `${baseRel.replace(/\/$/, "")}/`;
  for (const note of sorted) {
    const relToBase = note.rel.startsWith(normalizedBase)
      ? note.rel.slice(normalizedBase.length)
      : note.rel;
    const dirname = path.posix.dirname(relToBase);
    const group = dirname === "." ? "Notas" : dirname.split("/")[0];
    const entries = groups.get(group) ?? [];
    entries.push(note);
    groups.set(group, entries);
  }

  const sections = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([group, groupNotes]) =>
        `## ${group}\n\n${groupNotes.map(itemFor).join("\n")}`,
    );

  return `${title}\n\n${sections.join("\n\n")}\n`;
}

export class GenerateIndexTool implements ITool {
  readonly definition = {
    name: "markdown_vault_generate_index",
    description:
      "Generate or update a markdown index for a vault path",
    inputSchema: {
      type: "object" as const,
      properties: {
        dryRun: { type: "boolean" },
        includeDescriptions: { type: "boolean" },
        mode: {
          type: "string",
          enum: ["hierarchical", "flat"],
        },
        overwrite: { type: "boolean" },
        path: { type: "string", description: "Directory to index" },
        target: {
          type: "string",
          description: "Index note to create or update",
        },
      },
      required: ["path", "target"],
    },
  };

  constructor(private vault: IVaultAdvanced) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const inputPath = String(args.path ?? "");
    const targetPath = String(args.target ?? "");
    const includeDescriptions = args.includeDescriptions === true;
    const mode = args.mode === "flat" ? "flat" : "hierarchical";
    const overwrite = args.overwrite === true;
    const dryRun = args.dryRun === true;
    const target = await this.vault.resolveMarkdownFile(targetPath);

    if (target.exists && !overwrite && !dryRun) {
      throw new Error(
        `Index target already exists. Use overwrite: true or dryRun: true. Target: ${target.rel}`,
      );
    }

    const scanRoot = await this.vault.resolveVaultPath(inputPath);
    const baseRel = this.vault.relativePath(scanRoot);
    const notes = (
      await this.vault.loadMarkdownNotes(inputPath)
    ).filter((note) => note.rel !== target.rel);
    const content = buildIndexContent(notes, target.rel, baseRel, {
      includeDescriptions,
      mode,
    });

    if (dryRun) {
      const contentPreview = trimToChars(content, 8000);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                contentPreview,
                dryRun: true,
                filesIndexed: notes.length,
                previewTruncated: contentPreview !== content,
                target: target.rel,
                wouldCreate: !target.exists,
                wouldUpdate: target.exists,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    await this.vault.mkdir(path.dirname(target.abs));
    await this.vault.writeFile(target.abs, content);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              created: !target.exists,
              filesIndexed: notes.length,
              target: target.rel,
              updated: target.exists,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
