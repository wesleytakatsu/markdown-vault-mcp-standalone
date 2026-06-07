export const SERVER_VERSION = "1.2.0";
export const JSON_MIME = "application/json";
export const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

export const IGNORED_DIRS = new Set([
  ".git",
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

export const STOPWORDS = new Set([
  "a", "an", "and", "as", "at", "by", "com", "como", "da", "das",
  "de", "do", "dos", "e", "em", "for", "in", "no", "na", "nas",
  "nos", "o", "os", "para", "por", "the", "to", "um", "uma", "with",
]);
