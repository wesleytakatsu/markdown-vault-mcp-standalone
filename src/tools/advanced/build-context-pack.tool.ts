import path from "node:path";
import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVaultAdvanced } from "./vault-advanced.interface.js";
import type { MarkdownNote, RankedNote } from "../../types/markdown.js";
import { clampNumber } from "../../utils/validation.utils.js";
import { stringArray } from "../../utils/array.utils.js";
import { estimateTokens, trimToChars } from "../../utils/string.utils.js";
import { tokenize } from "../../utils/text-search.utils.js";
import { globMatcher } from "../../utils/glob.utils.js";
import { createNoteIndex, buildGraph } from "../../domain/markdown/link.service.js";
import {
  rankLoadedNotes,
  snippetFor,
  descriptionFor,
  fallbackTitle,
  firstParagraph,
} from "../../domain/note/note-ranking.js";
import {
  centralContextRefs,
  centralContextScore,
  centralContextMatch,
  extractAgentRules,
  relevantExcerpt,
} from "../../domain/note/context-pack.utils.js";

async function loadCandidateNotes(
  vault: IVaultAdvanced,
  inputPath: string,
  include: string[],
  exclude: string[],
): Promise<MarkdownNote[]> {
  const allRefs = await vault.listMarkdownFileRefs();
  const refs =
    include.length > 0
      ? allRefs
      : await vault.listMarkdownFileRefs(inputPath);
  const includeMatchers = include.map(globMatcher);
  const excludeMatchers = exclude.map(globMatcher);
  const isExcluded = (rel: string) =>
    excludeMatchers.some((matches) => matches(rel));
  const filtered = refs.filter((ref) => {
    const included =
      includeMatchers.length === 0 ||
      includeMatchers.some((matches) => matches(ref.rel));
    return included && !isExcluded(ref.rel);
  });
  const byRel = new Map(filtered.map((ref) => [ref.rel, ref]));

  for (const ref of centralContextRefs(allRefs, inputPath)) {
    if (!isExcluded(ref.rel)) byRel.set(ref.rel, ref);
  }

  const notes = await vault.loadAllMarkdownNotes();
  const noteByRel = new Map(notes.map((note) => [note.rel, note]));
  return [...byRel.values()]
    .map((ref) => noteByRel.get(ref.rel))
    .filter((note): note is MarkdownNote => Boolean(note));
}

function prioritizeContextPackFiles(
  ranked: RankedNote[],
  notes: MarkdownNote[],
): RankedNote[] {
  const byRel = new Map(ranked.map((entry) => [entry.note.rel, entry]));
  const ordered: RankedNote[] = [];
  const push = (
    note: MarkdownNote,
    score: number,
    matchedBy: string[],
  ) => {
    if (ordered.some((entry) => entry.note.rel === note.rel)) return;
    ordered.push(
      byRel.get(note.rel) ?? {
        matchedBy,
        note,
        score,
        snippet: snippetFor(note, []),
      },
    );
  };

  const central = notes
    .map((note) => ({ note, score: centralContextScore(note.rel) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.note.rel.localeCompare(b.note.rel),
    );

  for (const entry of central) {
    push(entry.note, entry.score, [centralContextMatch(entry.note.rel)]);
  }
  for (const entry of ranked)
    push(entry.note, entry.score, entry.matchedBy);
  return ordered;
}

function selectNotesForBudget(
  ranked: RankedNote[],
  topic: string,
  maxTokens: number,
): RankedNote[] {
  const selected: RankedNote[] = [];
  for (const entry of ranked) {
    const candidate = [...selected, entry];
    const content = buildContextPackContent(
      topic,
      candidate,
      maxTokens,
    );
    if (
      estimateTokens(content) <= maxTokens ||
      selected.length === 0
    ) {
      selected.push(entry);
    }
    if (
      estimateTokens(
        buildContextPackContent(topic, selected, maxTokens),
      ) >= maxTokens
    ) {
      break;
    }
  }
  return selected;
}

function buildContextPackContent(
  topic: string,
  selected: RankedNote[],
  maxTokens: number,
): string {
  const files = selected.map((entry) => entry.note.rel);
  const tokens = tokenize(topic);
  const lines: string[] = [
    `# Context Pack: ${topic}`,
    "",
    "## Arquivos usados",
    "",
    ...files.map((file) => `- \`${file}\``),
    "",
    "## Resumo consolidado",
    "",
  ];

  if (selected.length === 0) {
    lines.push(
      "Nenhum arquivo relevante encontrado dentro do limite informado.",
    );
  } else {
    for (const entry of selected) {
      const desc = descriptionFor(entry.note);
      lines.push(
        `- \`${entry.note.rel}\`: ${fallbackTitle(entry.note)}${desc ? ` - ${desc}` : ""}`,
      );
    }
  }

  lines.push("", "## Regras importantes para agentes", "");
  const rules = extractAgentRules(
    selected.map((entry) => entry.note),
  );
  lines.push(
    ...(rules.length > 0
      ? rules.map((rule) => `- ${rule}`)
      : ["- Nenhuma regra explicita encontrada."]),
  );
  lines.push("", "## Trechos relevantes", "");

  const remainingChars = Math.max(
    1200,
    maxTokens * 4 - lines.join("\n").length - 200,
  );
  const perFileChars = Math.max(
    500,
    Math.floor(remainingChars / Math.max(1, selected.length)),
  );
  for (const entry of selected) {
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
    content = `${content.slice(0, Math.floor(content.length * 0.9)).trimEnd()}\n\n[Context pack truncated to respect maxTokens]\n`;
  }
  return content;
}

export class BuildContextPackTool implements ITool {
  readonly definition = {
    name: "markdown_vault_build_context_pack",
    description:
      "Build a token-bounded markdown context pack for an AI agent task",
    inputSchema: {
      type: "object" as const,
      properties: {
        exclude: {
          type: "array",
          items: { type: "string" },
        },
        include: {
          type: "array",
          items: { type: "string" },
        },
        maxTokens: { type: "number" },
        mode: {
          type: "string",
          enum: ["agent", "research", "summary"],
        },
        path: {
          type: "string",
          description: "Base path to search",
        },
        topic: { type: "string" },
      },
      required: ["topic"],
    },
  };

  constructor(private vault: IVaultAdvanced) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const topic = String(args.topic ?? "");
    const inputPath =
      typeof args.path === "string" ? args.path : "";
    const maxTokens = clampNumber(args.maxTokens, 12000, 500, 100000);
    const include = stringArray(args.include);
    const exclude = stringArray(args.exclude);
    const notes = await loadCandidateNotes(
      this.vault,
      inputPath,
      include,
      exclude,
    );
    const index = createNoteIndex(notes);
    const graph = buildGraph(notes, index);
    const ranked = prioritizeContextPackFiles(
      rankLoadedNotes(notes, topic, graph, index),
      notes,
    );
    const selected = selectNotesForBudget(
      ranked,
      topic,
      maxTokens,
    );
    const content = buildContextPackContent(
      topic,
      selected,
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
              filesUsed: selected.map((entry) => entry.note.rel),
              topic,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
