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
import {
  clampMaxFuzzyDistance,
  isFuzzyEligible,
  withinFuzzyDistance,
} from "../../utils/fuzzy-match.utils.js";
import {
  expandWithSynonyms,
  type ExpandedToken,
  type SynonymDict,
  type SynonymMode,
} from "./synonym.service.js";

export type RankOptions = {
  fuzzy?: boolean;
  maxFuzzyDistance?: number;
  synonymMode?: SynonymMode;
  projectSynonyms?: SynonymDict | null;
};

const DIRECT_FIELD_WEIGHTS = {
  title: 8,
  heading: 6,
  tag: 5,
  frontmatter: 4,
  filename: 4,
} as const;

const SYNONYM_WEIGHT_RATIO = 0.6;
const FUZZY_WEIGHT_RATIO = 0.5;

function softWeight(directWeight: number, ratio: number): number {
  return Math.max(1, Math.round(directWeight * ratio));
}

const SYNONYM_FIELD_WEIGHTS = {
  title: softWeight(DIRECT_FIELD_WEIGHTS.title, SYNONYM_WEIGHT_RATIO),
  heading: softWeight(DIRECT_FIELD_WEIGHTS.heading, SYNONYM_WEIGHT_RATIO),
  tag: softWeight(DIRECT_FIELD_WEIGHTS.tag, SYNONYM_WEIGHT_RATIO),
  frontmatter: softWeight(DIRECT_FIELD_WEIGHTS.frontmatter, SYNONYM_WEIGHT_RATIO),
  filename: softWeight(DIRECT_FIELD_WEIGHTS.filename, SYNONYM_WEIGHT_RATIO),
} as const;

const FUZZY_FIELD_WEIGHTS = {
  title: softWeight(DIRECT_FIELD_WEIGHTS.title, FUZZY_WEIGHT_RATIO),
  filename: softWeight(DIRECT_FIELD_WEIGHTS.filename, FUZZY_WEIGHT_RATIO),
} as const;

// Limites aplicados em sequência sobre o conteúdo da nota: primeiro corta quantos
// tokens únicos entram na comparação, depois quantas comparações fuzzy podem rodar,
// e só por fim os caps de pontuação atuam sobre o resultado já obtido.
const MAX_CONTENT_TOKENS_FOR_FUZZY = 300;
const MAX_FUZZY_COMPARISONS_PER_NOTE = 2000;
const MAX_CONTENT_SCORE_PER_SYNONYM_GROUP = 2;
const MAX_CONTENT_FUZZY_SCORE = 2;
const MAX_NON_DIRECT_CONTENT_SCORE = 4;

type FuzzyQueryToken = { token: string; maxDistance: number };

function fieldHasFuzzyMatch(fieldText: string, fuzzyQueryTokens: FuzzyQueryToken[]): boolean {
  if (!fieldText || fuzzyQueryTokens.length === 0) return false;
  const candidates = tokenize(fieldText);
  if (candidates.length === 0) return false;
  return fuzzyQueryTokens.some(({ token, maxDistance }) =>
    candidates.some((candidate) => withinFuzzyDistance(token, candidate, maxDistance)),
  );
}

type ContentMatchTally = {
  matchedFuzzy: boolean;
  matchedSynonym: boolean;
  score: number;
};

function scoreNonDirectContentMatches(
  body: string,
  directTokens: string[],
  synonymTokens: ExpandedToken[],
  fuzzyQueryTokens: FuzzyQueryToken[],
): ContentMatchTally {
  const directSet = new Set(directTokens);
  const synonymGroupByToken = new Map<string, string | undefined>();
  for (const expanded of synonymTokens) {
    if (!synonymGroupByToken.has(expanded.token)) {
      synonymGroupByToken.set(expanded.token, expanded.group);
    }
  }

  const contentTokens = tokenize(body).slice(0, MAX_CONTENT_TOKENS_FOR_FUZZY);
  const groupMatchCounts = new Map<string, number>();
  let fuzzyMatchCount = 0;
  let comparisons = 0;
  let comparisonBudgetExceeded = false;

  for (const candidate of contentTokens) {
    if (directSet.has(candidate)) continue;

    if (synonymGroupByToken.has(candidate)) {
      const group = synonymGroupByToken.get(candidate) ?? candidate;
      groupMatchCounts.set(group, (groupMatchCounts.get(group) ?? 0) + 1);
    }

    if (fuzzyQueryTokens.length > 0 && !comparisonBudgetExceeded) {
      let matched = false;
      for (const { token, maxDistance } of fuzzyQueryTokens) {
        comparisons += 1;
        if (comparisons > MAX_FUZZY_COMPARISONS_PER_NOTE) {
          comparisonBudgetExceeded = true;
          break;
        }
        if (withinFuzzyDistance(token, candidate, maxDistance)) {
          matched = true;
          break;
        }
      }
      if (matched) fuzzyMatchCount += 1;
    }
  }

  let nonDirectScore = 0;
  let matchedSynonym = false;
  for (const count of groupMatchCounts.values()) {
    if (count <= 0) continue;
    matchedSynonym = true;
    nonDirectScore += Math.min(count, MAX_CONTENT_SCORE_PER_SYNONYM_GROUP);
  }

  let matchedFuzzy = false;
  if (fuzzyMatchCount > 0) {
    matchedFuzzy = true;
    nonDirectScore += Math.min(fuzzyMatchCount, MAX_CONTENT_FUZZY_SCORE);
  }

  return {
    matchedFuzzy,
    matchedSynonym,
    score: Math.min(nonDirectScore, MAX_NON_DIRECT_CONTENT_SCORE),
  };
}

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
  options?: RankOptions,
): RankedNote[] {
  const tokens = tokenize(query);
  const indexNotes = notes.filter((note) =>
    path.posix.basename(note.rel).toLowerCase().startsWith("index."),
  );
  const agentsNotes = notes.filter(
    (note) => path.posix.basename(note.rel).toLowerCase() === "agents.md",
  );

  const synonymMode = options?.synonymMode ?? "off";
  const expandedTokens =
    synonymMode === "off" ? [] : expandWithSynonyms(tokens, synonymMode, options?.projectSynonyms);
  const synonymTokens = expandedTokens.filter((expanded) => expanded.source === "synonym");
  const synonymTokenStrings = synonymTokens.map((expanded) => expanded.token);

  const fuzzyEnabled = options?.fuzzy === true;
  const fuzzyQueryTokens: FuzzyQueryToken[] = fuzzyEnabled
    ? tokens
        .filter(isFuzzyEligible)
        .map((token) => ({ token, maxDistance: clampMaxFuzzyDistance(token, options?.maxFuzzyDistance) }))
    : [];

  const entries = notes.map((note) => {
    let score = 0;
    const matchedBy = new Set<string>();

    let titleMatchedDirect = false;
    if (note.title && containsAnyToken(note.title, tokens)) {
      score += DIRECT_FIELD_WEIGHTS.title;
      addMatchedBy(matchedBy, "title");
      titleMatchedDirect = true;
    }
    if (note.title && !titleMatchedDirect) {
      if (synonymMode !== "off" && containsAnyToken(note.title, synonymTokenStrings)) {
        score += SYNONYM_FIELD_WEIGHTS.title;
        addMatchedBy(matchedBy, "title:synonym");
      }
      if (fuzzyEnabled && fieldHasFuzzyMatch(note.title, fuzzyQueryTokens)) {
        score += FUZZY_FIELD_WEIGHTS.title;
        addMatchedBy(matchedBy, "title:fuzzy");
      }
    }

    const headingText = note.headings.map((heading) => heading.text).join("\n");
    let headingMatchedDirect = false;
    if (containsAnyToken(headingText, tokens)) {
      score += DIRECT_FIELD_WEIGHTS.heading;
      addMatchedBy(matchedBy, "heading");
      headingMatchedDirect = true;
    }
    if (!headingMatchedDirect && synonymMode !== "off" && containsAnyToken(headingText, synonymTokenStrings)) {
      score += SYNONYM_FIELD_WEIGHTS.heading;
      addMatchedBy(matchedBy, "heading:synonym");
    }

    const tagText = note.tags.join(" ");
    let tagMatchedDirect = false;
    if (containsAnyToken(tagText, tokens)) {
      score += DIRECT_FIELD_WEIGHTS.tag;
      addMatchedBy(matchedBy, "tag");
      tagMatchedDirect = true;
    }
    if (!tagMatchedDirect && synonymMode !== "off" && containsAnyToken(tagText, synonymTokenStrings)) {
      score += SYNONYM_FIELD_WEIGHTS.tag;
      addMatchedBy(matchedBy, "tag:synonym");
    }

    const frontmatterText = JSON.stringify(note.frontmatter);
    let frontmatterMatchedDirect = false;
    if (containsAnyToken(frontmatterText, tokens)) {
      score += DIRECT_FIELD_WEIGHTS.frontmatter;
      addMatchedBy(matchedBy, "frontmatter");
      frontmatterMatchedDirect = true;
    }
    if (
      !frontmatterMatchedDirect &&
      synonymMode !== "off" &&
      containsAnyToken(frontmatterText, synonymTokenStrings)
    ) {
      score += SYNONYM_FIELD_WEIGHTS.frontmatter;
      addMatchedBy(matchedBy, "frontmatter:synonym");
    }

    let filenameMatchedDirect = false;
    if (containsAnyToken(note.rel, tokens)) {
      score += DIRECT_FIELD_WEIGHTS.filename;
      addMatchedBy(matchedBy, "filename");
      filenameMatchedDirect = true;
    }
    if (!filenameMatchedDirect) {
      if (synonymMode !== "off" && containsAnyToken(note.rel, synonymTokenStrings)) {
        score += SYNONYM_FIELD_WEIGHTS.filename;
        addMatchedBy(matchedBy, "filename:synonym");
      }
      if (fuzzyEnabled && fieldHasFuzzyMatch(note.rel, fuzzyQueryTokens)) {
        score += FUZZY_FIELD_WEIGHTS.filename;
        addMatchedBy(matchedBy, "filename:fuzzy");
      }
    }

    const contentMatches = Math.min(10, countTokenOccurrences(note.body, tokens));
    let contentMatchedDirect = false;
    if (contentMatches > 0) {
      score += contentMatches;
      addMatchedBy(matchedBy, "content");
      contentMatchedDirect = true;
    }
    if (!contentMatchedDirect && (synonymMode !== "off" || fuzzyEnabled)) {
      const contentBonus = scoreNonDirectContentMatches(note.body, tokens, synonymTokens, fuzzyQueryTokens);
      if (contentBonus.score > 0) {
        score += contentBonus.score;
        if (contentBonus.matchedSynonym) addMatchedBy(matchedBy, "content:synonym");
        if (contentBonus.matchedFuzzy) addMatchedBy(matchedBy, "content:fuzzy");
      }
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
