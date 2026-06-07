import path from "node:path";
import type {
  LinkGraph,
  MarkdownNote,
  NoteIndex,
  RankedNote,
} from "../../types/markdown.js";
import { resolveLink } from "../markdown/link.service.js";
import { stripMarkdownExtension, trimToChars, normalizeText } from "../../utils/string.utils.js";
import { containsAnyToken, countTokenOccurrences, tokenize } from "../../utils/text-search.utils.js";
import { MARKDOWN_EXTENSIONS } from "../../config/constants.js";

export function firstParagraph(body: string): string {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const paragraph of paragraphs) {
    if (/^#{1,6}\s/.test(paragraph)) continue;
    if (/^```/.test(paragraph)) continue;
    const compact = paragraph.replace(/\s+/g, " ");
    if (compact.length <= 260) return compact;
  }

  return "";
}

export function descriptionFor(note: MarkdownNote): string {
  const description = note.frontmatter.description;
  if (typeof description === "string" && description.trim()) {
    return description.trim();
  }
  return firstParagraph(note.body);
}

export function fallbackTitle(note: MarkdownNote): string {
  return note.title ?? path.posix.basename(stripMarkdownExtension(note.rel, MARKDOWN_EXTENSIONS));
}

export function snippetFor(note: MarkdownNote, tokens: string[], maxChars = 700): string {
  const lines = note.content.split(/\r?\n/);
  const matchLine = lines.findIndex((line) => containsAnyToken(line, tokens));
  if (matchLine >= 0) {
    const start = Math.max(0, matchLine - 2);
    const end = Math.min(lines.length, matchLine + 3);
    return trimToChars(lines.slice(start, end).join("\n").trim(), maxChars);
  }

  const paragraph = firstParagraph(note.body);
  if (paragraph) return trimToChars(paragraph, maxChars);
  return trimToChars(note.content.trim(), maxChars);
}

export function isSimilarText(left: string, right: string): boolean {
  const normalize = (value: string) =>
    normalizeText(value)
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return longer.startsWith(shorter) && longer.length <= Math.ceil(shorter.length * 1.25);
}

export function indexLabelFor(note: MarkdownNote, includeDescription: boolean): string {
  const title = fallbackTitle(note);
  if (!includeDescription) return title;

  const description = descriptionFor(note);
  if (!description || isSimilarText(title, description)) return title;
  return `${title} — ${description}`;
}

function addMatchedBy(matchedBy: Set<string>, value: string): void {
  matchedBy.add(value);
}

export function rankLoadedNotes(
  notes: MarkdownNote[],
  query: string,
  graph: LinkGraph,
  index: NoteIndex,
): RankedNote[] {
  const tokens = tokenize(query);
  const indexNotes = notes.filter((note) =>
    path.posix.basename(note.rel).toLowerCase().startsWith("index."),
  );
  const agentsNotes = notes.filter(
    (note) => path.posix.basename(note.rel).toLowerCase() === "agents.md",
  );

  const entries = notes.map((note) => {
    let score = 0;
    const matchedBy = new Set<string>();

    if (note.title && containsAnyToken(note.title, tokens)) {
      score += 8;
      addMatchedBy(matchedBy, "title");
    }

    if (containsAnyToken(note.headings.map((heading) => heading.text).join("\n"), tokens)) {
      score += 6;
      addMatchedBy(matchedBy, "heading");
    }

    if (containsAnyToken(note.tags.join(" "), tokens)) {
      score += 5;
      addMatchedBy(matchedBy, "tag");
    }

    if (containsAnyToken(JSON.stringify(note.frontmatter), tokens)) {
      score += 4;
      addMatchedBy(matchedBy, "frontmatter");
    }

    if (containsAnyToken(note.rel, tokens)) {
      score += 4;
      addMatchedBy(matchedBy, "filename");
    }

    const contentMatches = Math.min(10, countTokenOccurrences(note.body, tokens));
    if (contentMatches > 0) {
      score += contentMatches;
      addMatchedBy(matchedBy, "content");
    }

    if (
      indexNotes.some((source) =>
        source.links.some((link) => resolveLink(link, source.rel, index) === note.rel),
      )
    ) {
      score += 2;
      addMatchedBy(matchedBy, "index");
    }

    if (
      agentsNotes.some((source) =>
        source.links.some((link) => resolveLink(link, source.rel, index) === note.rel),
      )
    ) {
      score += 3;
      addMatchedBy(matchedBy, "agents");
    }

    const backlinkCount = graph.backlinks.get(note.rel)?.size ?? 0;
    if (backlinkCount > 0) {
      score += Math.min(5, backlinkCount);
      addMatchedBy(matchedBy, "backlink");
    }

    if (path.posix.basename(note.rel).toLowerCase() === "agents.md") {
      score += 3;
      addMatchedBy(matchedBy, "agents");
    }

    if (path.posix.basename(note.rel).toLowerCase().startsWith("index.")) {
      score += 2;
      addMatchedBy(matchedBy, "index");
    }

    return {
      matchedBy: [...matchedBy],
      note,
      score,
      snippet: snippetFor(note, tokens),
    };
  });

  const directMatchTypes = new Set([
    "content",
    "filename",
    "frontmatter",
    "heading",
    "tag",
    "title",
  ]);
  const directlyRelevant = new Set(
    entries
      .filter((entry) => entry.matchedBy.some((match) => directMatchTypes.has(match)))
      .map((entry) => entry.note.rel),
  );

  for (const entry of entries) {
    if (directlyRelevant.has(entry.note.rel)) continue;
    const outgoingToRelevant = [...(graph.outgoing.get(entry.note.rel) ?? [])].some((rel) =>
      directlyRelevant.has(rel),
    );
    const incomingFromRelevant = [...directlyRelevant].some((rel) =>
      graph.outgoing.get(rel)?.has(entry.note.rel),
    );
    if (!outgoingToRelevant && !incomingFromRelevant) continue;
    entry.score += 2;
    entry.matchedBy.push("link_proximity");
  }

  return entries
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.note.rel.localeCompare(b.note.rel));
}
