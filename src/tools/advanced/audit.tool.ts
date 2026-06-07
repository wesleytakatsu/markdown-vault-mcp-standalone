import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVaultAdvanced } from "./vault-advanced.interface.js";
import type { Issue } from "../../types/markdown.js";
import { clampNumber } from "../../utils/validation.utils.js";
import { DEFAULT_DIAGNOSE_CHECKS } from "../../config/constants.js";
import {
  buildDiagnosticIssues,
  addLintStructuralIssues,
  issueSort,
} from "../../domain/vault/diagnostics.js";
import { taskItemsFromNotes } from "../../domain/note/task-extraction.js";

function auditRecommendations(
  issues: Array<Issue & { source: string }>,
  taskCount: number,
  largeFileCount: number,
): string[] {
  const recommendations: string[] = [];
  const issueTypes = new Set(issues.map((issue) => issue.type));
  if (issueTypes.has("broken_links")) {
    recommendations.push(
      "Corrigir links quebrados antes de reorganizar notas.",
    );
  }
  if (issueTypes.has("broken_anchors")) {
    recommendations.push(
      "Atualizar anchors de headings após renomear seções.",
    );
  }
  if (issueTypes.has("missing_titles")) {
    recommendations.push(
      "Adicionar H1 em notas sem título para melhorar briefing e contexto.",
    );
  }
  if (issueTypes.has("missing_frontmatter")) {
    recommendations.push(
      "Adicionar frontmatter simples em documentos ativos.",
    );
  }
  if (
    issueTypes.has("heading_level_skip") ||
    issueTypes.has("multiple_h1")
  ) {
    recommendations.push(
      "Normalizar hierarquia de headings para outlines mais úteis.",
    );
  }
  if (largeFileCount > 0) {
    recommendations.push(
      "Dividir ou resumir arquivos grandes para reduzir custo de contexto.",
    );
  }
  if (taskCount > 0) {
    recommendations.push(
      "Revisar tarefas abertas extraídas do vault.",
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(
      "Nenhuma ação estrutural prioritária encontrada.",
    );
  }
  return recommendations;
}

export class AuditTool implements ITool {
  readonly definition = {
    name: "markdown_vault_audit",
    description: "Run a combined vault health audit for agents",
    inputSchema: {
      type: "object" as const,
      properties: {
        includeTasks: { type: "boolean" },
        maxIssues: { type: "number" },
        path: { type: "string" },
      },
    },
  };

  constructor(private vault: IVaultAdvanced) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const inputPath =
      typeof args.path === "string" ? args.path : "";
    const includeTasks = args.includeTasks !== false;
    const maxIssues = clampNumber(args.maxIssues, 20, 1, 200);
    const notes = await this.vault.loadMarkdownNotes(inputPath);
    const allNotes = inputPath
      ? await this.vault.loadAllMarkdownNotes()
      : notes;

    const diagnosticIssues = buildDiagnosticIssues(
      notes,
      new Set([...DEFAULT_DIAGNOSE_CHECKS]),
      allNotes,
    );
    const lintIssues: Issue[] = [];
    addLintStructuralIssues(notes, lintIssues);
    const tasks = includeTasks
      ? taskItemsFromNotes(notes, false)
      : [];
    const allIssues = [
      ...diagnosticIssues.map((issue) => ({
        ...issue,
        source: "diagnose",
      })),
      ...lintIssues.map((issue) => ({ ...issue, source: "lint" })),
    ].sort(issueSort);
    const errorCount = allIssues.filter(
      (issue) => issue.severity === "error",
    ).length;
    const warningCount = allIssues.filter(
      (issue) => issue.severity === "warning",
    ).length;
    const largeFiles = notes
      .filter(
        (note) =>
          note.lineCount > 800 || note.charCount > 30000,
      )
      .map((note) => ({
        chars: note.charCount,
        lines: note.lineCount,
        path: note.rel,
      }));
    const score = Math.max(
      0,
      Math.round(
        100 -
          errorCount * 12 -
          warningCount * 3 -
          Math.min(tasks.length, 20) * 0.5,
      ),
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              path: inputPath,
              recommendations: auditRecommendations(
                allIssues as Array<Issue & { source: string }>,
                tasks.length,
                largeFiles.length,
              ),
              summary: {
                diagnosticIssues: diagnosticIssues.length,
                errors: errorCount,
                filesScanned: notes.length,
                largeFiles: largeFiles.length,
                lintIssues: lintIssues.length,
                score,
                tasks: tasks.length,
                warnings: warningCount,
              },
              topIssues: allIssues.slice(0, maxIssues),
              ...(includeTasks
                ? { tasks: tasks.slice(0, maxIssues) }
                : {}),
              largeFiles,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
