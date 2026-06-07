import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVaultAdvanced } from "./vault-advanced.interface.js";
import type { Issue } from "../../types/markdown.js";
import { createNoteIndex } from "../../domain/markdown/link.service.js";
import {
  addBrokenLinkIssues,
  addBrokenAnchorIssues,
  addMissingTitleIssues,
  addDuplicateTitleIssues,
  addLargeFileIssues,
  addLintStructuralIssues,
  issueSort,
} from "../../domain/vault/diagnostics.js";

export class LintTool implements ITool {
  readonly definition = {
    name: "markdown_vault_lint",
    description:
      "Lint a markdown vault for AI-agent documentation quality",
    inputSchema: {
      type: "object" as const,
      properties: {
        dryRun: { type: "boolean" },
        fix: { type: "boolean" },
        path: { type: "string" },
      },
      required: ["path"],
    },
  };

  constructor(private vault: IVaultAdvanced) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const inputPath = String(args.path ?? "");
    const fix = args.fix === true;
    const dryRun = args.dryRun === true;
    const notes = await this.vault.loadMarkdownNotes(inputPath);
    const allNotes = inputPath
      ? await this.vault.loadAllMarkdownNotes()
      : notes;
    const issues: Issue[] = [];
    const index = createNoteIndex(allNotes);
    const fixes: Array<{
      changes: string[];
      lines?: number[];
      path: string;
    }> = [];
    let fixed = 0;

    addBrokenLinkIssues(notes, index, issues);
    addBrokenAnchorIssues(notes, index, issues);
    addMissingTitleIssues(notes, issues);
    addDuplicateTitleIssues(notes, issues);
    addLargeFileIssues(notes, issues);

    for (const note of notes) {
      const h1s = note.headings.filter(
        (heading) => heading.level === 1,
      );
      if (h1s.length > 1) {
        issues.push({
          file: note.rel,
          line: h1s[1].line,
          message: "File contains multiple H1 headings.",
          severity: "warning",
          type: "multiple_h1",
        });
      }

      let previousLevel = 0;
      for (const heading of note.headings) {
        if (
          previousLevel > 0 &&
          heading.level > previousLevel + 1
        ) {
          issues.push({
            file: note.rel,
            line: heading.line,
            message: `Heading jumps from H${previousLevel} to H${heading.level}.`,
            severity: "warning",
            type: "heading_level_skip",
          });
        }
        previousLevel = heading.level;
      }

      if (note.yamlError) {
        issues.push({
          file: note.rel,
          line: 1,
          message: note.yamlError,
          severity: "error",
          type: "frontmatter_invalid",
        });
      }

      const trailingLines = note.content.split(/\r?\n/);
      const trailingSpaceLines: number[] = [];
      for (let i = 0; i < trailingLines.length; i += 1) {
        if (/[ \t]+$/.test(trailingLines[i])) {
          trailingSpaceLines.push(i + 1);
          issues.push({
            file: note.rel,
            line: i + 1,
            message: "Line has trailing spaces.",
            severity: "warning",
            type: "trailing_spaces",
          });
        }
      }

      if (fix) {
        const fixedContent = note.content
          .split(/\r?\n/)
          .map((line) => line.replace(/[ \t]+$/g, ""))
          .join("\n")
          .replace(/\s*$/, "\n");
        if (fixedContent !== note.content) {
          const changes: string[] = [];
          if (trailingSpaceLines.length > 0)
            changes.push("remove_trailing_spaces");
          if (!note.content.endsWith("\n"))
            changes.push("ensure_final_newline");
          if (changes.length === 0)
            changes.push("normalize_final_newline");
          fixes.push({
            changes,
            ...(trailingSpaceLines.length > 0
              ? { lines: trailingSpaceLines }
              : {}),
            path: note.rel,
          });

          if (!dryRun) {
            await this.vault.writeFile(note.abs, fixedContent);
            fixed += 1;
          }
        }
      }
    }

    const sortedIssues = issues.sort(issueSort);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ...(dryRun ? { dryRun: true, fixes } : {}),
              issues: sortedIssues,
              path: inputPath,
              summary: {
                filesScanned: notes.length,
                fixed,
                issuesFound: sortedIssues.length,
                ...(dryRun ? { wouldFix: fixes.length } : {}),
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
