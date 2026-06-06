import path from "node:path";

export const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

export const IGNORED_DIRS = new Set([
  ".git",
  ".obsidian",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export const DEFAULT_DIAGNOSE_CHECKS = [
  "broken_links",
  "broken_anchors",
  "missing_titles",
  "duplicate_titles",
  "empty_files",
  "orphan_notes",
  "missing_frontmatter",
  "large_files",
] as const;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "com",
  "como",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "for",
  "in",
  "no",
  "na",
  "nas",
  "nos",
  "o",
  "os",
  "para",
  "por",
  "the",
  "to",
  "um",
  "uma",
  "with",
]);

export function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

export function isInside(base: string, candidate: string): boolean {
  const rel = path.relative(base, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function isMarkdownPath(value: string): boolean {
  return MARKDOWN_EXTENSIONS.has(path.extname(value).toLowerCase());
}

export function stripMarkdownExtension(value: string): string {
  const ext = path.posix.extname(value);
  return MARKDOWN_EXTENSIONS.has(ext.toLowerCase())
    ? value.slice(0, -ext.length)
    : value;
}

export function normalizeRelPath(value: string): string {
  return path.posix.normalize(value.replace(/\\/g, "/")).replace(/^\.\//, "");
}

export function normalizeRelCandidate(value: string): string | undefined {
  const normalized = normalizeRelPath(value);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function tokenize(value: string): string[] {
  const words = normalizeText(value).match(/[a-z0-9]+/g) ?? [];
  return [...new Set(words.filter((word) => word.length > 1 && !STOPWORDS.has(word)))];
}

export function containsAnyToken(value: string, tokens: string[]): boolean {
  const normalized = normalizeText(value);
  return tokens.some((token) => normalized.includes(token));
}

export function countTokenOccurrences(value: string, tokens: string[]): number {
  const normalized = normalizeText(value);
  let count = 0;
  for (const token of tokens) {
    let cursor = normalized.indexOf(token);
    while (cursor >= 0) {
      count += 1;
      cursor = normalized.indexOf(token, cursor + token.length);
    }
  }
  return count;
}

export function trimToChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

export function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
