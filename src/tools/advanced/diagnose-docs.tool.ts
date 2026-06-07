import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVaultAdvanced } from "./vault-advanced.interface.js";
import { DEFAULT_DIAGNOSE_CHECKS } from "../../config/constants.js";
import { buildDiagnosticIssues } from "../../domain/vault/diagnostics.js";

export class DiagnoseDocsTool implements ITool {
  readonly definition = {
    name: "markdown_vault_diagnose_docs",
    description:
      "Run documentation diagnostics for agent-friendly markdown",
    inputSchema: {
      type: "object" as const,
      properties: {
        checks: {
          type: "array",
          items: {
            type: "string",
            enum: [...DEFAULT_DIAGNOSE_CHECKS],
          },
        },
        path: {
          type: "string",
          description: "Directory or file to diagnose",
        },
      },
      required: ["path"],
    },
  };

  constructor(private vault: IVaultAdvanced) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const inputPath = String(args.path ?? "");
    const requested = Array.isArray(args.checks)
      ? args.checks.filter(
          (check): check is string => typeof check === "string",
        )
      : [...DEFAULT_DIAGNOSE_CHECKS];
    const checks = new Set(requested);
    const notes = await this.vault.loadMarkdownNotes(inputPath);
    const allNotes = inputPath
      ? await this.vault.loadAllMarkdownNotes()
      : notes;
    const issues = buildDiagnosticIssues(notes, checks, allNotes);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              issues,
              path: inputPath,
              summary: {
                filesScanned: notes.length,
                issuesFound: issues.length,
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
