import path from "node:path";
import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVaultAdvanced } from "./vault-advanced.interface.js";
import type {
  MarkdownNote,
  RankedNote,
  Issue,
} from "../../types/markdown.js";
import { clampNumber } from "../../utils/validation.utils.js";
import { estimateTokens } from "../../utils/string.utils.js";
import { tokenize } from "../../utils/text-search.utils.js";
import { createNoteIndex, buildGraph } from "../../domain/markdown/link.service.js";
import { rankLoadedNotes, snippetFor } from "../../domain/note/note-ranking.js";
import { buildDiagnosticIssues } from "../../domain/vault/diagnostics.js";
import {
  extractAgentRules,
  extractDecisionLines,
  relevantExcerpt,
} from "../../domain/note/context-pack.utils.js";

async function loadBriefingNotes(
  vault: IVaultAdvanced,
  inputPath: string,
): Promise<MarkdownNote[]> {
  const refs = new Map<string, { abs: string; rel: string }>();
  for (const ref of await vault.listMarkdownFileRefs(inputPath)) {
    refs.set(ref.rel, ref);
  }
  for (const ref of await vault.listMarkdownFileRefs()) {
    if (path.posix.basename(ref.rel).toLowerCase() === "agents.md") {
      refs.set(ref.rel, ref);
    }
  }
  const notes = await vault.loadAllMarkdownNotes();
  const noteByRel = new Map(notes.map((note) => [note.rel, note]));
  return [...refs.values()]
    .map((ref) => noteByRel.get(ref.rel))
    .filter((note): note is MarkdownNote => Boolean(note));
}

function prioritizeBriefingFiles(
  ranked: RankedNote[],
  notes: MarkdownNote[],
): RankedNote[] {
  const byRel = new Map(
    ranked.map((entry) => [entry.note.rel, entry]),
  );
  const ordered: RankedNote[] = [];
  const push = (
    note: MarkdownNote,
    score: number,
    matchedBy: string[],
  ) => {
    if (ordered.some((entry) => entry.note.rel === note.rel))
      return;
    ordered.push(
      byRel.get(note.rel) ?? {
        matchedBy,
        note,
        score,
        snippet: snippetFor(note, []),
      },
    );
  };

  for (const note of notes) {
    if (
      path.posix.basename(note.rel).toLowerCase() === "agents.md"
    ) {
      push(note, 100, ["agents"]);
    }
  }
  for (const note of notes) {
    if (
      path.posix
        .basename(note.rel)
        .toLowerCase()
        .startsWith("index.")
    ) {
      push(note, 90, ["index"]);
    }
  }
  for (const entry of ranked) {
    if (
      ordered.some(
        (candidate) => candidate.note.rel === entry.note.rel,
      )
    )
      continue;
    ordered.push(entry);
  }
  return ordered;
}

function buildBriefingContent(
  task: string,
  recommended: RankedNote[],
  diagnostics: Issue[],
  maxTokens: number,
): string {
  const lines: string[] = [
    "# Briefing para agente",
    "",
    "## Tarefa",
    "",
    task,
    "",
    "## Leia primeiro",
    "",
  ];

  recommended.slice(0, 5).forEach((entry, index) => {
    lines.push(`${index + 1}. \`${entry.note.rel}\``);
  });

  lines.push("", "## Regras relevantes encontradas", "");
  const rules = extractAgentRules(
    recommended.map((entry) => entry.note),
  );
  lines.push(
    ...(rules.length > 0
      ? rules.map((rule) => `- ${rule}`)
      : [
          "- Nenhuma regra explicita encontrada.",
        ]),
  );

  lines.push("", "## Decisões técnicas relevantes", "");
  const decisions = extractDecisionLines(
    recommended.map((entry) => entry.note),
  );
  lines.push(
    ...(decisions.length > 0
      ? decisions.map((decision) => `- ${decision}`)
      : [
          "- Consulte os arquivos recomendados antes de alterar comportamento existente.",
        ]),
  );

  lines.push("", "## Possíveis riscos", "");
  const riskIssues = diagnostics.slice(0, 8);
  if (riskIssues.length === 0) {
    lines.push(
      "- Nenhum risco estrutural encontrado nos checks rápidos.",
    );
  } else {
    for (const issue of riskIssues) {
      lines.push(
        `- ${issue.file}${issue.line ? `:${issue.line}` : ""}: ${issue.message}`,
      );
    }
  }

  lines.push("", "## Próximos passos sugeridos", "");
  lines.push("- Leia os arquivos na ordem recomendada.");
  lines.push(
    "- Confirme links internos e frontmatter antes de mover ou renomear notas.",
  );
  lines.push(
    "- Atualize `docs/index.md` quando criar notas novas.",
  );

  lines.push("", "## Trechos relevantes", "");
  const tokens = tokenize(task);
  const perFileChars = Math.max(
    500,
    Math.floor(
      (maxTokens * 4) / Math.max(1, recommended.length + 3),
    ),
  );
  for (const entry of recommended.slice(0, 6)) {
    lines.push(`### ${entry.note.rel}`, "");
    lines.push(
      relevantExcerpt(entry.note, tokens, perFileChars),
      "",
    );
  }

  let content = lines.join("\n").trimEnd() + "\n";
  while (
    estimateTokens(content) > maxTokens &&
    content.length > 500
  ) {
    content = `${content.slice(0, Math.floor(content.length * 0.9)).trimEnd()}\n\n[Briefing truncated to respect maxTokens]\n`;
  }
  return content;
}

export class GenerateAgentBriefingTool implements ITool {
  readonly definition = {
    name: "markdown_vault_generate_agent_briefing",
    description:
      "Generate a concise task briefing for an AI agent",
    inputSchema: {
      type: "object" as const,
      properties: {
        maxTokens: { type: "number" },
        path: { type: "string" },
        task: { type: "string" },
      },
      required: ["task"],
    },
  };

  constructor(private vault: IVaultAdvanced) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const task = String(args.task ?? "");
    const inputPath =
      typeof args.path === "string" ? args.path : "";
    const maxTokens = clampNumber(
      args.maxTokens,
      6000,
      500,
      50000,
    );
    const notes = await loadBriefingNotes(this.vault, inputPath);
    const index = createNoteIndex(notes);
    const graph = buildGraph(notes, index);
    const ranked = rankLoadedNotes(notes, task, graph, index);
    const recommended = prioritizeBriefingFiles(ranked, notes).slice(
      0,
      8,
    );
    const diagnostics = buildDiagnosticIssues(
      notes,
      new Set(["broken_links", "large_files", "missing_titles"]),
    );
    const content = buildBriefingContent(
      task,
      recommended,
      diagnostics,
      maxTokens,
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              content,
              estimatedTokens: estimateTokens(content),
              recommendedFiles: recommended.map(
                (entry) => entry.note.rel,
              ),
              task,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
