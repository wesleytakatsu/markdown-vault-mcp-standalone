import path from "node:path";

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripLineEnding(line: string): string {
  return line.replace(/\r?\n$/, "");
}

export function splitLinesWithEndings(content: string): string[] {
  return content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, "");
}

export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map(normalizeTag).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function ensureTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

export function normalizeHeading(value: string): string {
  return value
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s+#+$/, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function trimToPreview(content: string, maxChars = 1000): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

export function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
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

export function trimToChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

export function isInside(base: string, candidate: string): boolean {
  const rel = path.relative(base, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function stripMarkdownExtension(
  value: string,
  extensions: Set<string>,
): string {
  const ext = path.posix.extname(value);
  return extensions.has(ext.toLowerCase()) ? value.slice(0, -ext.length) : value;
}
