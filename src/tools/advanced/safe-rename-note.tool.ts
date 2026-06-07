import path from "node:path";
import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVaultAdvanced } from "./vault-advanced.interface.js";
import type {
  MarkdownNote,
  NoteIndex,
  LinkMatch,
} from "../../types/markdown.js";
import {
  createNoteIndex,
  linkMatchesTarget,
  splitWikiTarget,
  stripLinkDecorations,
  removeAnchorAndQuery,
  wikilinkBetween,
  markdownLinkBetween,
  linkSuffix,
} from "../../domain/markdown/link.service.js";

function computeRenameUpdates(
  notes: MarkdownNote[],
  index: NoteIndex,
  fromRel: string,
  toRel: string,
): Array<{ content: string; path: string; replacements: number }> {
  const updates: Array<{
    content: string;
    path: string;
    replacements: number;
  }> = [];
  for (const note of notes) {
    let replacements = 0;
    const next = note.content
      .replace(/\[\[([^\]\n]+)\]\]/g, (raw, inner: string) => {
        const parsed = splitWikiTarget(inner);
        const link: LinkMatch = {
          alias: parsed.alias,
          line: 0,
          raw,
          target: parsed.pathPart,
          text: "",
          type: "wikilink",
        };
        if (!linkMatchesTarget(link, note.rel, fromRel, index))
          return raw;
        replacements += 1;
        const anchorIndex = parsed.pathPart.indexOf("#");
        const anchor =
          anchorIndex >= 0
            ? parsed.pathPart.slice(anchorIndex)
            : "";
        const sourceDir = path.posix.dirname(
          note.rel === fromRel ? toRel : note.rel,
        );
        const target = wikilinkBetween(sourceDir, toRel) + anchor;
        return `[[${target}${parsed.alias ? `|${parsed.alias}` : ""}]]`;
      })
      .replace(
        /(!?)\[([^\]\n]*)\]\(([^)\n]+)\)/g,
        (raw, bang: string, text: string, hrefRaw: string) => {
          if (bang === "!") return raw;
          const href = stripLinkDecorations(hrefRaw);
          const link: LinkMatch = {
            href,
            line: 0,
            raw,
            target: href,
            text: "",
            type: "markdown",
          };
          if (!linkMatchesTarget(link, note.rel, fromRel, index))
            return raw;
          replacements += 1;
          const sourceDir = path.posix.dirname(
            note.rel === fromRel ? toRel : note.rel,
          );
          const visibleHref = markdownLinkBetween(
            sourceDir,
            toRel,
            href,
          );
          return `[${text}](${visibleHref})`;
        },
      );

    if (replacements > 0) {
      updates.push({
        content: next,
        path: note.rel,
        replacements,
      });
    }
  }
  return updates;
}

export class SafeRenameNoteTool implements ITool {
  readonly definition = {
    name: "markdown_vault_safe_rename_note",
    description:
      "Rename a note and optionally update internal markdown/wiki links",
    inputSchema: {
      type: "object" as const,
      properties: {
        dryRun: { type: "boolean" },
        from: { type: "string" },
        to: { type: "string" },
        updateLinks: { type: "boolean" },
      },
      required: ["from", "to"],
    },
  };

  constructor(private vault: IVaultAdvanced) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const from = await this.vault.resolveMarkdownFile(
      String(args.from ?? ""),
      { mustExist: true },
    );
    const to = await this.vault.resolveMarkdownFile(
      String(args.to ?? ""),
    );
    const updateLinks = args.updateLinks !== false;
    const dryRun = args.dryRun === true;

    if (to.exists) {
      throw new Error(
        `Target file already exists. Use another path or remove the target first: ${to.rel}`,
      );
    }

    const notes = await this.vault.loadAllMarkdownNotes();
    const index = createNoteIndex(notes);
    const updates = updateLinks
      ? computeRenameUpdates(notes, index, from.rel, to.rel)
      : [];

    if (dryRun) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                dryRun: true,
                filesToUpdate: updates.map(
                  ({ path: rel, replacements }) => ({
                    path: rel,
                    replacements,
                  }),
                ),
                from: from.rel,
                to: to.rel,
                wouldRename: true,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    await this.vault.mkdir(path.dirname(to.abs));
    await this.vault.rename(from.abs, to.abs);

    for (const update of updates) {
      const abs =
        update.path === from.rel
          ? to.abs
          : (index.byRel.get(update.path)?.abs ?? "");
      if (!abs) continue;
      await this.vault.writeFile(abs, update.content);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              dryRun: false,
              filesUpdated: updates.map(
                ({ path: rel, replacements }) => ({
                  path: rel === from.rel ? to.rel : rel,
                  replacements,
                }),
              ),
              renamed: true,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
