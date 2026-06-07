import path from "node:path";
import type { MarkdownNote } from "../../types/markdown.js";
import { containsAnyToken, } from "../../utils/text-search.utils.js";
import { trimToChars } from "../../utils/string.utils.js";
import { firstParagraph } from "./note-ranking.js";
import { isWithinInputPath } from "../../utils/glob.utils.js";

export function centralContextScore(rel: string): number {
  const lower = rel.toLowerCase();
  const basename = path.posix.basename(lower);
  if (basename === "agents.md") return 100;
  if (basename === "readme.md") return 95;
  if (lower === "docs/index.md") return 92;
  if (basename === "index.md" || basename === "index.markdown") return 90;
  return 0;
}

export function centralContextMatch(rel: string): string {
  const lower = rel.toLowerCase();
  if (path.posix.basename(lower) === "agents.md") return "agents";
  if (path.posix.basename(lower) === "readme.md") return "readme";
  return "index";
}

export function centralContextRefs(
  refs: Array<{ abs: string; rel: string }>,
  inputPath: string,
): Array<{ abs: string; rel: string }> {
  return refs.filter((ref) => {
    const relLower = ref.rel.toLowerCase();
    const basename = path.posix.basename(relLower);
    if (relLower === "agents.md" || relLower === "readme.md") return true;
    if (relLower === "docs/index.md") return true;
    return basename === "index.md" || basename === "index.markdown"
      ? isWithinInputPath(ref.rel, inputPath)
      : false;
  });
}

export function extractAgentRules(notes: MarkdownNote[]): string[] {
  const rules: string[] = [];
  const re =
    /\b(rule|regra|must|never|always|sempre|nunca|não|nao|avoid|evite|obrigatorio|obrigatório)\b/i;
  for (const note of notes) {
    if (path.posix.basename(note.rel).toLowerCase() !== "agents.md") continue;
    for (const line of note.content.split(/\r?\n/)) {
      const clean = line.replace(/^[-*]\s+/, "").trim();
      if (clean.length < 8 || clean.length > 220) continue;
      if (re.test(clean)) rules.push(clean);
      if (rules.length >= 8) break;
    }
  }
  return [...new Set(rules)].slice(0, 8);
}

export function extractDecisionLines(notes: MarkdownNote[]): string[] {
  const re = /\b(decis[aã]o|decision|adr|arquitetura|architecture|trade-?off|risco|risk)\b/i;
  const lines: string[] = [];
  for (const note of notes) {
    for (const line of note.content.split(/\r?\n/)) {
      const clean = line.replace(/^[-*]\s+/, "").trim();
      if (clean.length < 12 || clean.length > 220) continue;
      if (re.test(clean)) lines.push(`${note.rel}: ${clean}`);
      if (lines.length >= 8) return [...new Set(lines)];
    }
  }
  return [...new Set(lines)];
}

export function relevantExcerpt(note: MarkdownNote, tokens: string[], maxChars: number): string {
  if (note.content.length <= maxChars) return note.content.trim();

  const pieces: string[] = [];
  if (note.title) pieces.push(`# ${note.title}`);
  if (note.rawFrontmatter) pieces.push(`---\n${note.rawFrontmatter}\n---`);

  const relevantHeadings = note.headings
    .filter((heading) => containsAnyToken(heading.text, tokens))
    .map((heading) => `${"#".repeat(heading.level)} ${heading.text}`)
    .slice(0, 6);
  pieces.push(...relevantHeadings);

  const lines = note.content.split(/\r?\n/);
  const used = new Set<number>();
  for (let i = 0; i < lines.length; i += 1) {
    if (!containsAnyToken(lines[i], tokens)) continue;
    const start = Math.max(0, i - 2);
    const end = Math.min(lines.length, i + 3);
    const block: string[] = [];
    for (let cursor = start; cursor < end; cursor += 1) {
      if (used.has(cursor)) continue;
      used.add(cursor);
      block.push(lines[cursor]);
    }
    if (block.length > 0) pieces.push(block.join("\n"));
    if (pieces.join("\n\n").length >= maxChars) break;
  }

  if (pieces.length <= (note.title ? 1 : 0) + (note.rawFrontmatter ? 1 : 0)) {
    pieces.push(firstParagraph(note.body) || note.content.slice(0, maxChars));
  }

  return trimToChars(pieces.filter(Boolean).join("\n\n"), maxChars);
}
