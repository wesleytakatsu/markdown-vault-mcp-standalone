#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  advancedToolDefinitions,
  callAdvancedTool,
  isAdvancedTool,
} from "./core/advanced.js";

const SERVER_VERSION = "1.2.0";
const JSON_MIME = "application/json";
const MODULE_PATH = fileURLToPath(import.meta.url);
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type Frontmatter = Record<string, JsonValue>;

type Heading = {
  level: number;
  text: string;
  line: number;
  startOffset: number;
  contentStartOffset: number;
  endOffset: number;
};

const VAULT_PATH =
  process.env.MARKDOWN_VAULT_PATH ?? (() => {
    const fromScript = path.resolve(
      MODULE_PATH,
      "../../../docs",
    );
    if (fs.existsSync(fromScript)) return fromScript;
    const fromCwd = path.resolve(process.cwd(), "docs");
    if (fs.existsSync(fromCwd)) return fromCwd;
    return "";
  })();

const VAULT_ROOT = VAULT_PATH ? path.resolve(VAULT_PATH) : "";
const VAULT_REAL_ROOT =
  VAULT_ROOT && fs.existsSync(VAULT_ROOT) ? fs.realpathSync(VAULT_ROOT) : "";

function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function jsonResponse(value: unknown) {
  return textResponse(JSON.stringify(value, null, 2));
}

function resolveVault(p = ""): string {
  if (!VAULT_ROOT) {
    throw new Error("Vault path is not configured");
  }

  const abs = path.resolve(VAULT_ROOT, p);
  const rel = path.relative(VAULT_ROOT, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Refusing to access path outside vault. Path traversal denied.");
  }
  assertRealPathInsideVault(abs);
  return abs;
}

function assertMarkdownPath(p: string): void {
  if (!MARKDOWN_EXTENSIONS.has(path.extname(p).toLowerCase())) {
    throw new Error("Only .md and .markdown note files are supported");
  }
}

function assertRealPathInsideVault(abs: string): void {
  if (!VAULT_REAL_ROOT) {
    throw new Error("Vault path does not exist");
  }

  let cursor = abs;
  while (true) {
    try {
      const real = fs.realpathSync(cursor);
      const rel = path.relative(VAULT_REAL_ROOT, real);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error("Refusing to access path outside vault. Path traversal denied.");
      }
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw err;
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        throw new Error("Refusing to access path outside vault. Path traversal denied.");
      }
      cursor = parent;
    }
  }
}

function resolveNote(p: string): string {
  assertMarkdownPath(p);
  return resolveVault(p);
}

function relativePath(abs: string): string {
  return path.relative(VAULT_ROOT, abs).split(path.sep).join("/");
}

async function* walkMarkdownFiles(root: string): AsyncGenerator<string> {
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(root);
  } catch (err) {
    if (path.relative(VAULT_ROOT, root) === "") throw err;
    return;
  }

  if (stat.isFile()) {
    if (MARKDOWN_EXTENSIONS.has(path.extname(root).toLowerCase())) yield root;
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch (err) {
    if (path.relative(VAULT_ROOT, root) === "") throw err;
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkMarkdownFiles(full);
    } else if (
      entry.isFile() &&
      MARKDOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
      yield full;
    }
  }
}

async function listMarkdownFiles(root = VAULT_ROOT): Promise<string[]> {
  const files: string[] = [];
  for await (const file of walkMarkdownFiles(root)) {
    files.push(relativePath(file));
  }
  return files.sort();
}

async function fileExists(abs: string): Promise<boolean> {
  try {
    await fsp.access(abs);
    return true;
  } catch {
    return false;
  }
}

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function assertExpectedSha256(
  abs: string,
  expectedSha256?: string,
): Promise<string | undefined> {
  if (!expectedSha256) return undefined;

  const current = await fsp.readFile(abs, "utf-8");
  const currentSha256 = sha256(current);
  if (currentSha256 !== expectedSha256) {
    throw new Error(
      `SHA-256 mismatch: expected ${expectedSha256}, got ${currentSha256}`,
    );
  }
  return current;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripLineEnding(line: string): string {
  return line.replace(/\r?\n$/, "");
}

function splitLinesWithEndings(content: string): string[] {
  return content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function splitInlineArray(value: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (const char of value) {
    if ((char === '"' || char === "'") && quote === null) {
      quote = char;
      current += char;
      continue;
    }
    if (char === quote) {
      quote = null;
      current += char;
      continue;
    }
    if (char === "," && quote === null) {
      items.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim() || value.endsWith(",")) {
    items.push(current.trim());
  }
  return items;
}

function parseScalar(value: string): JsonValue {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "~") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return splitInlineArray(inner).map(parseScalar);
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function parseFrontmatter(raw: string): Frontmatter {
  const result: Frontmatter = {};
  const lines = raw.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match) continue;

    const [, key, value = ""] = match;
    if (value.trim()) {
      result[key] = parseScalar(value);
      continue;
    }

    const items: JsonValue[] = [];
    let cursor = i + 1;
    while (cursor < lines.length) {
      const itemMatch = lines[cursor].match(/^\s*-\s+(.*)$/);
      if (!itemMatch) break;
      items.push(parseScalar(itemMatch[1]));
      cursor += 1;
    }

    if (items.length > 0) {
      result[key] = items;
      i = cursor - 1;
    } else {
      result[key] = "";
    }
  }

  return result;
}

function splitFrontmatter(content: string): {
  body: string;
  frontmatter: Frontmatter;
  hasFrontmatter: boolean;
  rawFrontmatter: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return {
      body: content,
      frontmatter: {},
      hasFrontmatter: false,
      rawFrontmatter: "",
    };
  }

  return {
    body: content.slice(match[0].length),
    frontmatter: parseFrontmatter(match[1]),
    hasFrontmatter: true,
    rawFrontmatter: match[1],
  };
}

function formatYamlScalar(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(value);
  }

  if (!value || /[:#[\]{},&*?|\-<>=!%@`]/.test(value) || /^\s|\s$/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function serializeFrontmatter(frontmatter: Frontmatter): string {
  const keys = Object.keys(frontmatter).filter(
    (key) => frontmatter[key] !== undefined,
  );
  if (keys.length === 0) return "";

  const lines: string[] = [];
  for (const key of keys) {
    const value = frontmatter[key];
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${formatYamlScalar(item)}`);
        }
      }
    } else {
      lines.push(`${key}: ${formatYamlScalar(value)}`);
    }
  }

  return `---\n${lines.join("\n")}\n---\n`;
}

function replaceFrontmatter(content: string, frontmatter: Frontmatter): string {
  const parsed = splitFrontmatter(content);
  const serialized = serializeFrontmatter(frontmatter);
  if (!serialized) return parsed.body;
  return `${serialized}${parsed.body}`;
}

function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, "");
}

function normalizeTags(tags: string[]): string[] {
  const unique = new Set<string>();
  for (const tag of tags.map(normalizeTag).filter(Boolean)) {
    unique.add(tag);
  }
  return [...unique].sort((a, b) => a.localeCompare(b));
}

function frontmatterTags(frontmatter: Frontmatter): string[] {
  const value = frontmatter.tags;
  if (Array.isArray(value)) {
    return normalizeTags(
      value
        .filter((item): item is string => typeof item === "string")
        .flatMap((item) => item.split(/[\s,]+/)),
    );
  }
  if (typeof value === "string") {
    return normalizeTags(value.split(/[\s,]+/));
  }
  return [];
}

function inlineTags(body: string): string[] {
  const tags: string[] = [];
  const re = /(^|[\s([{])#([A-Za-z0-9_/-]+)\b/gm;
  let match: RegExpExecArray | null;

  while ((match = re.exec(body)) !== null) {
    tags.push(match[2]);
  }

  return normalizeTags(tags);
}

function noteTags(content: string): string[] {
  const parsed = splitFrontmatter(content);
  return normalizeTags([
    ...frontmatterTags(parsed.frontmatter),
    ...inlineTags(parsed.body),
  ]);
}

function extractLinks(body: string): string[] {
  const links = new Set<string>();

  for (const match of body.matchAll(/\[\[([^\]]+)\]\]/g)) {
    links.add(match[1].trim());
  }

  for (const match of body.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    links.add(match[1].trim());
  }

  return [...links].sort((a, b) => a.localeCompare(b));
}

function normalizeHeading(value: string): string {
  return value
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s+#+$/, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getHeadings(content: string): Heading[] {
  const lines = splitLinesWithEndings(content);
  const headings: Heading[] = [];
  let offset = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const text = stripLineEnding(line);
    const match = text.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        line: i + 1,
        startOffset: offset,
        contentStartOffset: offset + line.length,
        endOffset: content.length,
      });
    }
    offset += line.length;
  }

  for (let i = 0; i < headings.length; i += 1) {
    const current = headings[i];
    const next = headings
      .slice(i + 1)
      .find((candidate) => candidate.level <= current.level);
    current.endOffset = next?.startOffset ?? content.length;
  }

  return headings;
}

function findHeading(content: string, heading: string): Heading | undefined {
  const wanted = normalizeHeading(heading);
  return getHeadings(content).find(
    (candidate) => normalizeHeading(candidate.text) === wanted,
  );
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function appendHeadingSection(
  content: string,
  heading: string,
  headingLevel: number,
  patchContent: string,
): string {
  const prefix = content.trimEnd();
  const hashes = "#".repeat(Math.min(Math.max(headingLevel, 1), 6));
  const section = `${hashes} ${heading.trim()}\n${ensureTrailingNewline(
    patchContent.trimEnd(),
  )}`;
  return prefix ? `${prefix}\n\n${section}` : section;
}

function patchHeadingContent(
  content: string,
  heading: string,
  operation: "append" | "prepend" | "replace",
  patchContent: string,
  createHeading = false,
  headingLevel = 2,
): string {
  const target = findHeading(content, heading);
  if (!target) {
    if (createHeading) {
      return appendHeadingSection(content, heading, headingLevel, patchContent);
    }
    throw new Error(`Heading not found: ${heading}`);
  }

  if (operation === "replace") {
    const prefix = ensureTrailingNewline(content.slice(0, target.contentStartOffset));
    const suffix = content.slice(target.endOffset);
    const replacement = ensureTrailingNewline(patchContent.trimEnd());
    return `${prefix}${replacement}${suffix}`;
  }

  if (operation === "prepend") {
    const prefix = ensureTrailingNewline(content.slice(0, target.contentStartOffset));
    const suffix = content.slice(target.contentStartOffset).replace(/^\s*/, "");
    const insertion = `${ensureTrailingNewline(patchContent.trimEnd())}\n`;
    return `${prefix}${insertion}${suffix}`;
  }

  const before = content.slice(0, target.endOffset).trimEnd();
  const suffix = content.slice(target.endOffset);
  const insertion = `\n\n${ensureTrailingNewline(patchContent.trimEnd())}`;
  return `${before}${insertion}${suffix}`;
}

function buildSearchRegex(options: {
  caseSensitive?: boolean;
  query: string;
  regex?: boolean;
  wholeWord?: boolean;
}): RegExp {
  const source = options.regex ? options.query : escapeRegExp(options.query);
  const bounded = options.wholeWord ? `\\b${source}\\b` : source;
  return new RegExp(bounded, options.caseSensitive ? "g" : "gi");
}

function replaceMatches(
  content: string,
  options: {
    all?: boolean;
    caseSensitive?: boolean;
    contextLines?: number;
    dotAll?: boolean;
    maxPreviewMatches?: number;
    multiline?: boolean;
    regex?: boolean;
    regexFlags?: string;
    replace: string;
    search: string;
    wholeWord?: boolean;
  },
): {
  changed: boolean;
  content: string;
  matches: Array<{
    column: number;
    context: string;
    line: number;
    match: string;
    replacement: string;
  }>;
  replacements: number;
} {
  const source = options.regex ? options.search : escapeRegExp(options.search);
  const bounded = options.wholeWord ? `\\b${source}\\b` : source;
  const flags = buildRegexFlags(options);
  const re = new RegExp(bounded, flags);
  const contextLines = Math.max(0, Math.min(options.contextLines ?? 0, 10));
  const maxPreviewMatches = Math.max(0, Math.min(options.maxPreviewMatches ?? 10, 100));
  const matches = previewRegexMatches(
    content,
    re,
    options.replace,
    contextLines,
    maxPreviewMatches,
  );
  let replacements = 0;
  const next = content.replace(re, () => {
    replacements += 1;
    return options.replace;
  });
  return {
    changed: next !== content,
    content: next,
    matches,
    replacements,
  };
}

function buildRegexFlags(options: {
  all?: boolean;
  caseSensitive?: boolean;
  dotAll?: boolean;
  multiline?: boolean;
  regexFlags?: string;
}): string {
  const flags = new Set<string>();
  if (options.all !== false) flags.add("g");
  if (!options.caseSensitive) flags.add("i");
  if (options.multiline) flags.add("m");
  if (options.dotAll) flags.add("s");

  for (const flag of options.regexFlags ?? "") {
    if (!/[dgimsuvy]/.test(flag)) {
      throw new Error(`Unsupported regex flag: ${flag}`);
    }
    if (flag === "g") continue;
    flags.add(flag);
  }

  if (options.all === false) flags.delete("g");
  return [...flags].join("");
}

function lineColumnAt(content: string, offset: number): { column: number; line: number } {
  const before = content.slice(0, offset);
  const lines = before.split(/\r?\n/);
  return {
    column: lines[lines.length - 1].length + 1,
    line: lines.length,
  };
}

function lineContext(content: string, line: number, contextLines: number): string {
  const lines = content.split(/\r?\n/);
  const start = Math.max(0, line - 1 - contextLines);
  const end = Math.min(lines.length, line + contextLines);
  return lines.slice(start, end).join("\n");
}

function previewRegexMatches(
  content: string,
  re: RegExp,
  replacement: string,
  contextLines: number,
  maxPreviewMatches: number,
): Array<{
  column: number;
  context: string;
  line: number;
  match: string;
  replacement: string;
}> {
  if (maxPreviewMatches === 0) return [];

  const previewRe = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  const matches: Array<{
    column: number;
    context: string;
    line: number;
    match: string;
    replacement: string;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = previewRe.exec(content)) !== null) {
    const position = lineColumnAt(content, match.index);
    matches.push({
      ...position,
      context: lineContext(content, position.line, contextLines),
      match: match[0],
      replacement,
    });
    if (matches.length >= maxPreviewMatches) break;
    if (match[0].length === 0) previewRe.lastIndex += 1;
  }

  return matches;
}

function sectionContent(
  content: string,
  heading: string,
  includeHeading = true,
): { endOffset: number; section: string; startOffset: number; target: Heading } {
  const target = findHeading(content, heading);
  if (!target) throw new Error(`Heading not found: ${heading}`);

  const startOffset = includeHeading ? target.startOffset : target.contentStartOffset;
  return {
    endOffset: target.endOffset,
    section: content.slice(startOffset, target.endOffset),
    startOffset,
    target,
  };
}

function deleteSectionContent(
  content: string,
  heading: string,
  includeHeading = true,
): { next: string; removed: string; target: Heading } {
  const section = sectionContent(content, heading, includeHeading);
  const prefix = content.slice(0, section.startOffset).trimEnd();
  const suffix = content.slice(section.endOffset).replace(/^\s*/, "");
  const separator = prefix && suffix ? "\n\n" : "";
  return {
    next: `${prefix}${separator}${suffix}`,
    removed: section.section,
    target: section.target,
  };
}

function appendToDocument(content: string, patchContent: string): string {
  const prefix = content.trimEnd();
  const insertion = ensureTrailingNewline(patchContent.trimEnd());
  return prefix ? `${prefix}\n\n${insertion}` : insertion;
}

function trimToPreview(content: string, maxChars = 1000): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function removeInlineTagsFromBody(body: string, tagsToRemove: string[]): string {
  let next = body;
  for (const tag of normalizeTags(tagsToRemove)) {
    const re = new RegExp(`(^|[\\s([{])#${escapeRegExp(tag)}\\b`, "gm");
    next = next.replace(re, "$1");
  }
  return next.replace(/[ \t]{2,}/g, " ");
}

async function readNoteDetails(relPath: string) {
  const abs = resolveNote(relPath);
  const stat = await fsp.stat(abs);
  const content = await fsp.readFile(abs, "utf-8");
  const parsed = splitFrontmatter(content);
  const headings = getHeadings(parsed.body).map((heading) => ({
    level: heading.level,
    text: heading.text,
    line: heading.line,
  }));

  return {
    content,
    frontmatter: parsed.frontmatter,
    headings,
    links: extractLinks(parsed.body),
    metadata: {
      modified: stat.mtime.toISOString(),
      path: relPath,
      sha256: sha256(content),
      size: stat.size,
    },
    tags: noteTags(content),
  };
}

async function listAllTags(options: {
  includeFiles?: boolean;
  path?: string;
} = {}) {
  const root = resolveVault(options.path ?? "");
  const tagMap = new Map<string, { count: number; files: Set<string> }>();

  for await (const file of walkMarkdownFiles(root)) {
    const rel = relativePath(file);
    const content = await fsp.readFile(file, "utf-8");
    const parsed = splitFrontmatter(content);
    const tags = [
      ...frontmatterTags(parsed.frontmatter),
      ...inlineTags(parsed.body),
    ];

    for (const tag of tags) {
      const entry = tagMap.get(tag) ?? { count: 0, files: new Set<string>() };
      entry.count += 1;
      entry.files.add(rel);
      tagMap.set(tag, entry);
    }
  }

  const tags = [...tagMap.entries()]
    .map(([tag, entry]) => ({
      count: entry.count,
      files: options.includeFiles
        ? [...entry.files].sort((a, b) => a.localeCompare(b))
        : undefined,
      tag,
    }))
    .sort((a, b) => a.tag.localeCompare(b.tag));

  return {
    tags,
    totalOccurrences: tags.reduce((sum, tag) => sum + tag.count, 0),
    totalTags: tags.length,
  };
}

function noteUri(relPath: string): string {
  return `markdown-vault://vault/${relPath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

function pathFromNoteUri(uri: string): string {
  const parsed = new URL(uri);
  if (parsed.protocol !== "markdown-vault:" || parsed.hostname !== "vault") {
    throw new Error(`Unsupported resource URI: ${uri}`);
  }
  return parsed.pathname
    .replace(/^\//, "")
    .split("/")
    .map((part) => decodeURIComponent(part))
    .join("/");
}

export const server = new Server(
  {
    name: "markdown-vault-mcp-standalone",
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_files",
      description: "List markdown files in the vault",
      inputSchema: {
        type: "object",
        properties: {
          includeMetadata: {
            type: "boolean",
            description: "Return size and modification time as JSON",
          },
          path: {
            type: "string",
            description: "Optional subdirectory or markdown file relative to vault root",
          },
        },
      },
    },
    {
      name: "read_file",
      description: "Read a markdown note as content, metadata, outline, or full JSON",
      inputSchema: {
        type: "object",
        properties: {
          format: {
            type: "string",
            enum: ["content", "metadata", "outline", "full"],
            description: "Response shape; defaults to content",
          },
          path: {
            type: "string",
            description: "Markdown file path relative to vault root (e.g. index.md)",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "search",
      description: "Search markdown notes with literal or regex matching",
      inputSchema: {
        type: "object",
        properties: {
          caseSensitive: { type: "boolean" },
          contextLines: {
            type: "number",
            description: "Number of lines before and after each match; defaults to 1",
          },
          format: {
            type: "string",
            enum: ["text", "json"],
            description: "Response shape; defaults to text",
          },
          limit: {
            type: "number",
            description: "Maximum matches to return; defaults to 50",
          },
          path: {
            type: "string",
            description: "Optional subdirectory or markdown file to search",
          },
          query: {
            type: "string",
            description: "Text or regex pattern to search for",
          },
          regex: { type: "boolean" },
          wholeWord: { type: "boolean" },
        },
        required: ["query"],
      },
    },
    {
      name: "append_file",
      description: "Append content to a note or to a specific heading section",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", description: "Content to append" },
          createHeading: {
            type: "boolean",
            description: "Create the heading if it does not exist",
          },
          expectedSha256: {
            type: "string",
            description: "Optional SHA-256 guard for the current file content",
          },
          heading: {
            type: "string",
            description: "Optional heading text to append under",
          },
          headingLevel: {
            type: "number",
            description: "Heading level when createHeading is true; defaults to 2",
          },
          path: { type: "string", description: "Markdown file path relative to vault root" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "write_file",
      description: "Create or overwrite a markdown note; overwrite must be explicit",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", description: "Content to write" },
          createDirs: {
            type: "boolean",
            description: "Create parent directories; defaults to true",
          },
          expectedSha256: {
            type: "string",
            description: "Optional SHA-256 guard for overwrites",
          },
          overwrite: {
            type: "boolean",
            description: "Required to overwrite an existing note",
          },
          path: { type: "string", description: "Markdown file path relative to vault root" },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "replace_in_file",
      description: "Replace literal text or regex matches inside one note",
      inputSchema: {
        type: "object",
        properties: {
          all: {
            type: "boolean",
            description: "Replace all matches; defaults to true",
          },
          caseSensitive: { type: "boolean" },
          expectedSha256: {
            type: "string",
            description: "Optional SHA-256 guard for the current file content",
          },
          contextLines: {
            type: "number",
            description: "Preview context lines around each match; defaults to 0",
          },
          dotAll: {
            type: "boolean",
            description: "Regex dotAll mode; equivalent to the s flag",
          },
          dryRun: {
            type: "boolean",
            description: "Preview matches and output without writing the file",
          },
          maxPreviewMatches: {
            type: "number",
            description: "Maximum preview matches to return; defaults to 10",
          },
          multiline: {
            type: "boolean",
            description: "Regex multiline mode; equivalent to the m flag",
          },
          path: { type: "string", description: "Markdown file path relative to vault root" },
          regex: { type: "boolean" },
          regexFlags: {
            type: "string",
            description: "Additional regex flags; g is controlled by all",
          },
          replace: { type: "string" },
          search: { type: "string" },
          wholeWord: { type: "boolean" },
        },
        required: ["path", "search", "replace"],
      },
    },
    {
      name: "read_section",
      description: "Read a markdown heading section from one note",
      inputSchema: {
        type: "object",
        properties: {
          heading: { type: "string" },
          includeHeading: {
            type: "boolean",
            description: "Include the heading line in the returned content; defaults to true",
          },
          path: { type: "string", description: "Markdown file path relative to vault root" },
        },
        required: ["path", "heading"],
      },
    },
    {
      name: "markdown_vault_read_section",
      description: "Alias for read_section; read a markdown heading section from one note",
      inputSchema: {
        type: "object",
        properties: {
          heading: { type: "string" },
          includeHeading: {
            type: "boolean",
            description: "Include the heading line in the returned content; defaults to true",
          },
          path: { type: "string", description: "Markdown file path relative to vault root" },
        },
        required: ["path", "heading"],
      },
    },
    {
      name: "delete_section",
      description: "Delete a markdown heading section from one note",
      inputSchema: {
        type: "object",
        properties: {
          dryRun: { type: "boolean" },
          expectedSha256: {
            type: "string",
            description: "Optional SHA-256 guard for the current file content",
          },
          heading: { type: "string" },
          includeHeading: {
            type: "boolean",
            description: "Delete the heading line too; defaults to true",
          },
          path: { type: "string", description: "Markdown file path relative to vault root" },
        },
        required: ["path", "heading"],
      },
    },
    {
      name: "markdown_vault_delete_section",
      description: "Alias for delete_section; delete a markdown heading section from one note",
      inputSchema: {
        type: "object",
        properties: {
          dryRun: { type: "boolean" },
          expectedSha256: {
            type: "string",
            description: "Optional SHA-256 guard for the current file content",
          },
          heading: { type: "string" },
          includeHeading: {
            type: "boolean",
            description: "Delete the heading line too; defaults to true",
          },
          path: { type: "string", description: "Markdown file path relative to vault root" },
        },
        required: ["path", "heading"],
      },
    },
    {
      name: "move_section",
      description: "Move a markdown heading section from one note to another note",
      inputSchema: {
        type: "object",
        properties: {
          createTarget: {
            type: "boolean",
            description: "Create target note if it does not exist; defaults to true",
          },
          createTargetHeading: {
            type: "boolean",
            description: "Create target heading if append/prepend under heading is requested",
          },
          dryRun: { type: "boolean" },
          expectedSourceSha256: {
            type: "string",
            description: "Optional SHA-256 guard for the source file",
          },
          expectedTargetSha256: {
            type: "string",
            description: "Optional SHA-256 guard for the target file",
          },
          heading: { type: "string", description: "Source section heading" },
          includeHeading: {
            type: "boolean",
            description: "Move the heading line too; defaults to true",
          },
          operation: {
            type: "string",
            enum: ["append", "prepend"],
            description: "How to insert under targetHeading; defaults to append",
          },
          sourcePath: { type: "string" },
          targetHeading: {
            type: "string",
            description: "Optional heading in the target note to append/prepend under",
          },
          targetHeadingLevel: {
            type: "number",
            description: "Heading level when createTargetHeading is true; defaults to 2",
          },
          targetPath: { type: "string" },
        },
        required: ["sourcePath", "targetPath", "heading"],
      },
    },
    {
      name: "markdown_vault_move_section",
      description: "Alias for move_section; move a markdown heading section between notes",
      inputSchema: {
        type: "object",
        properties: {
          createTarget: {
            type: "boolean",
            description: "Create target note if it does not exist; defaults to true",
          },
          createTargetHeading: {
            type: "boolean",
            description: "Create target heading if append/prepend under heading is requested",
          },
          dryRun: { type: "boolean" },
          expectedSourceSha256: {
            type: "string",
            description: "Optional SHA-256 guard for the source file",
          },
          expectedTargetSha256: {
            type: "string",
            description: "Optional SHA-256 guard for the target file",
          },
          heading: { type: "string", description: "Source section heading" },
          includeHeading: {
            type: "boolean",
            description: "Move the heading line too; defaults to true",
          },
          operation: {
            type: "string",
            enum: ["append", "prepend"],
            description: "How to insert under targetHeading; defaults to append",
          },
          sourcePath: { type: "string" },
          targetHeading: {
            type: "string",
            description: "Optional heading in the target note to append/prepend under",
          },
          targetHeadingLevel: {
            type: "number",
            description: "Heading level when createTargetHeading is true; defaults to 2",
          },
          targetPath: { type: "string" },
        },
        required: ["sourcePath", "targetPath", "heading"],
      },
    },
    {
      name: "patch_note",
      description: "Append, prepend, or replace content under a markdown heading",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string" },
          createHeading: {
            type: "boolean",
            description: "Create the heading if it does not exist",
          },
          expectedSha256: {
            type: "string",
            description: "Optional SHA-256 guard for the current file content",
          },
          heading: { type: "string" },
          headingLevel: {
            type: "number",
            description: "Heading level when createHeading is true; defaults to 2",
          },
          operation: {
            type: "string",
            enum: ["append", "prepend", "replace"],
          },
          path: { type: "string", description: "Markdown file path relative to vault root" },
        },
        required: ["path", "heading", "operation", "content"],
      },
    },
    {
      name: "manage_frontmatter",
      description: "Get, set, or delete simple YAML frontmatter keys",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["get", "set", "delete"] },
          expectedSha256: {
            type: "string",
            description: "Optional SHA-256 guard for set/delete",
          },
          key: {
            type: "string",
            description: "Frontmatter key; omit on get to return all keys",
          },
          path: { type: "string", description: "Markdown file path relative to vault root" },
          value: {
            description: "JSON value to set",
          },
        },
        required: ["path", "action"],
      },
    },
    {
      name: "list_tags",
      description: "List tags found in frontmatter and inline markdown tags",
      inputSchema: {
        type: "object",
        properties: {
          includeFiles: {
            type: "boolean",
            description: "Include files where each tag appears",
          },
          path: {
            type: "string",
            description: "Optional subdirectory or markdown file relative to vault root",
          },
        },
      },
    },
    {
      name: "manage_tags",
      description: "List, add, or remove tags in frontmatter and/or inline note text",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "add", "remove"] },
          expectedSha256: {
            type: "string",
            description: "Optional SHA-256 guard for add/remove",
          },
          location: {
            type: "string",
            enum: ["frontmatter", "inline", "both"],
            description: "Where to edit tags; defaults to frontmatter",
          },
          path: { type: "string", description: "Markdown file path relative to vault root" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags to add or remove",
          },
        },
        required: ["path", "action"],
      },
    },
    {
      name: "get_periodic_note",
      description: "Get periodic note filename for today (daily, weekly, etc.)",
      inputSchema: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["daily", "weekly", "monthly", "quarterly", "yearly"],
            description: "Period type",
          },
        },
        required: ["period"],
      },
    },
    ...advancedToolDefinitions,
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  const args = request.params.arguments ?? {};

  if (isAdvancedTool(name)) {
    return jsonResponse(
      await callAdvancedTool(name, args as Record<string, unknown>, VAULT_ROOT),
    );
  }

  switch (name) {
    case "list_files": {
      const { includeMetadata, path: subPath = "" } = args as {
        includeMetadata?: boolean;
        path?: string;
      };
      const root = resolveVault(subPath);
      const files = await listMarkdownFiles(root);

      if (!includeMetadata) {
        return textResponse(files.join("\n"));
      }

      const entries = await Promise.all(
        files.map(async (file) => {
          const stat = await fsp.stat(resolveNote(file));
          return {
            modified: stat.mtime.toISOString(),
            path: file,
            size: stat.size,
          };
        }),
      );
      return jsonResponse({ files: entries });
    }

    case "read_file": {
      const { format = "content", path: notePath } = args as {
        format?: "content" | "metadata" | "outline" | "full";
        path: string;
      };
      const details = await readNoteDetails(notePath);

      if (format === "content") return textResponse(details.content);
      if (format === "metadata") {
        const { content: _content, ...metadata } = details;
        return jsonResponse(metadata);
      }
      if (format === "outline") return jsonResponse({ headings: details.headings });
      return jsonResponse(details);
    }

    case "search": {
      const {
        caseSensitive,
        contextLines = 1,
        format = "text",
        limit = 50,
        path: subPath = "",
        query,
        regex,
        wholeWord,
      } = args as {
        caseSensitive?: boolean;
        contextLines?: number;
        format?: "text" | "json";
        limit?: number;
        path?: string;
        query: string;
        regex?: boolean;
        wholeWord?: boolean;
      };

      const root = resolveVault(subPath);
      const matcher = buildSearchRegex({ caseSensitive, query, regex, wholeWord });
      const maxResults = Math.max(1, Math.min(limit, 500));
      const context = Math.max(0, Math.min(contextLines, 10));
      const results: Array<{
        context: string;
        line: number;
        path: string;
        text: string;
      }> = [];

      for await (const file of walkMarkdownFiles(root)) {
        const content = await fsp.readFile(file, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i += 1) {
          matcher.lastIndex = 0;
          if (!matcher.test(lines[i])) continue;

          results.push({
            context: lines
              .slice(Math.max(0, i - context), i + context + 1)
              .join("\n"),
            line: i + 1,
            path: relativePath(file),
            text: lines[i],
          });

          if (results.length >= maxResults) break;
        }
        if (results.length >= maxResults) break;
      }

      if (format === "json") {
        return jsonResponse({ query, results, totalReturned: results.length });
      }

      const text =
        results
          .map((result) => `${result.path}:${result.line}:\n${result.context}\n---`)
          .join("\n") || "No matches found";
      return textResponse(text);
    }

    case "append_file": {
      const {
        content,
        createHeading,
        expectedSha256,
        heading,
        headingLevel = 2,
        path: notePath,
      } = args as {
        content: string;
        createHeading?: boolean;
        expectedSha256?: string;
        heading?: string;
        headingLevel?: number;
        path: string;
      };
      const abs = resolveNote(notePath);
      const exists = await fileExists(abs);
      if (exists) await assertExpectedSha256(abs, expectedSha256);

      await fsp.mkdir(path.dirname(abs), { recursive: true });
      const current = exists ? await fsp.readFile(abs, "utf-8") : "";
      const next = heading
        ? patchHeadingContent(
            current,
            heading,
            "append",
            content,
            createHeading,
            headingLevel,
          )
        : current
          ? `${current.trimEnd()}\n${ensureTrailingNewline(content.trimEnd())}`
          : ensureTrailingNewline(content.trimEnd());

      await fsp.writeFile(abs, next, "utf-8");
      return jsonResponse({
        path: notePath,
        sha256: sha256(next),
        size: Buffer.byteLength(next, "utf-8"),
      });
    }

    case "write_file": {
      const {
        content,
        createDirs = true,
        expectedSha256,
        overwrite,
        path: notePath,
      } = args as {
        content: string;
        createDirs?: boolean;
        expectedSha256?: string;
        overwrite?: boolean;
        path: string;
      };
      const abs = resolveNote(notePath);
      const exists = await fileExists(abs);
      if (exists && !overwrite) {
        throw new Error(
          "Target file already exists. Use another path or pass overwrite: true to replace it.",
        );
      }
      if (exists) await assertExpectedSha256(abs, expectedSha256);
      if (createDirs) await fsp.mkdir(path.dirname(abs), { recursive: true });

      await fsp.writeFile(abs, content, "utf-8");
      return jsonResponse({
        overwritten: exists,
        path: notePath,
        sha256: sha256(content),
        size: Buffer.byteLength(content, "utf-8"),
      });
    }

    case "replace_in_file": {
      const {
        all,
        caseSensitive,
        contextLines,
        dotAll,
        dryRun,
        expectedSha256,
        maxPreviewMatches,
        multiline,
        path: notePath,
        regex,
        regexFlags,
        replace,
        search,
        wholeWord,
      } = args as {
        all?: boolean;
        caseSensitive?: boolean;
        contextLines?: number;
        dotAll?: boolean;
        dryRun?: boolean;
        expectedSha256?: string;
        maxPreviewMatches?: number;
        multiline?: boolean;
        path: string;
        regex?: boolean;
        regexFlags?: string;
        replace: string;
        search: string;
        wholeWord?: boolean;
      };
      const abs = resolveNote(notePath);
      const guarded = await assertExpectedSha256(abs, expectedSha256);
      const beforeSha256 = guarded ? sha256(guarded) : undefined;
      const current = guarded ?? (await fsp.readFile(abs, "utf-8"));
      const result = replaceMatches(current, {
        all,
        caseSensitive,
        contextLines,
        dotAll,
        maxPreviewMatches,
        multiline,
        regex,
        regexFlags,
        replace,
        search,
        wholeWord,
      });

      if (!dryRun && result.changed) {
        await fsp.writeFile(abs, result.content, "utf-8");
      }
      return jsonResponse({
        changed: result.changed,
        ...(dryRun ? { dryRun: true } : {}),
        matches: result.matches,
        path: notePath,
        replacements: result.replacements,
        sha256After: sha256(result.content),
        sha256Before: beforeSha256 ?? sha256(current),
        sha256: sha256(result.content),
        wouldWrite: result.changed && dryRun === true,
      });
    }

    case "read_section":
    case "markdown_vault_read_section": {
      const {
        heading,
        includeHeading = true,
        path: notePath,
      } = args as {
        heading: string;
        includeHeading?: boolean;
        path: string;
      };
      const abs = resolveNote(notePath);
      const current = await fsp.readFile(abs, "utf-8");
      const section = sectionContent(current, heading, includeHeading);
      return jsonResponse({
        content: section.section,
        heading,
        includeHeading,
        path: notePath,
        section: {
          endOffset: section.endOffset,
          line: section.target.line,
          startOffset: section.startOffset,
        },
        sha256: sha256(current),
      });
    }

    case "delete_section":
    case "markdown_vault_delete_section": {
      const {
        dryRun,
        expectedSha256,
        heading,
        includeHeading = true,
        path: notePath,
      } = args as {
        dryRun?: boolean;
        expectedSha256?: string;
        heading: string;
        includeHeading?: boolean;
        path: string;
      };
      const abs = resolveNote(notePath);
      const guarded = await assertExpectedSha256(abs, expectedSha256);
      const current = guarded ?? (await fsp.readFile(abs, "utf-8"));
      const result = deleteSectionContent(current, heading, includeHeading);
      if (!dryRun && result.next !== current) {
        await fsp.writeFile(abs, result.next, "utf-8");
      }
      return jsonResponse({
        changed: result.next !== current,
        ...(dryRun ? { dryRun: true } : {}),
        heading,
        includeHeading,
        path: notePath,
        removedChars: result.removed.length,
        removedPreview: trimToPreview(result.removed),
        sha256After: sha256(result.next),
        sha256Before: sha256(current),
        wouldWrite: dryRun === true && result.next !== current,
      });
    }

    case "move_section":
    case "markdown_vault_move_section": {
      const {
        createTarget = true,
        createTargetHeading = false,
        dryRun,
        expectedSourceSha256,
        expectedTargetSha256,
        heading,
        includeHeading = true,
        operation = "append",
        sourcePath,
        targetHeading,
        targetHeadingLevel = 2,
        targetPath,
      } = args as {
        createTarget?: boolean;
        createTargetHeading?: boolean;
        dryRun?: boolean;
        expectedSourceSha256?: string;
        expectedTargetSha256?: string;
        heading: string;
        includeHeading?: boolean;
        operation?: "append" | "prepend";
        sourcePath: string;
        targetHeading?: string;
        targetHeadingLevel?: number;
        targetPath: string;
      };
      const sourceAbs = resolveNote(sourcePath);
      const targetAbs = resolveNote(targetPath);
      if (sourceAbs === targetAbs) {
        throw new Error("move_section does not support moving within the same file");
      }

      const guardedSource = await assertExpectedSha256(sourceAbs, expectedSourceSha256);
      const sourceCurrent = guardedSource ?? (await fsp.readFile(sourceAbs, "utf-8"));
      const sourceResult = deleteSectionContent(sourceCurrent, heading, includeHeading);

      const targetExists = await fileExists(targetAbs);
      if (!targetExists && !createTarget) {
        throw new Error("Target file does not exist. Pass createTarget: true to create it.");
      }
      let targetCurrent = "";
      if (targetExists) {
        const guardedTarget = await assertExpectedSha256(targetAbs, expectedTargetSha256);
        targetCurrent = guardedTarget ?? (await fsp.readFile(targetAbs, "utf-8"));
      }

      const targetNext = targetHeading
        ? patchHeadingContent(
            targetCurrent,
            targetHeading,
            operation,
            sourceResult.removed,
            createTargetHeading,
            targetHeadingLevel,
          )
        : appendToDocument(targetCurrent, sourceResult.removed);

      if (!dryRun) {
        await fsp.writeFile(sourceAbs, sourceResult.next, "utf-8");
        await fsp.mkdir(path.dirname(targetAbs), { recursive: true });
        await fsp.writeFile(targetAbs, targetNext, "utf-8");
      }

      return jsonResponse({
        ...(dryRun ? { dryRun: true } : {}),
        heading,
        includeHeading,
        movedChars: sourceResult.removed.length,
        movedPreview: trimToPreview(sourceResult.removed),
        source: {
          path: sourcePath,
          sha256After: sha256(sourceResult.next),
          sha256Before: sha256(sourceCurrent),
        },
        target: {
          created: !targetExists,
          path: targetPath,
          sha256After: sha256(targetNext),
          sha256Before: targetExists ? sha256(targetCurrent) : null,
        },
        wouldWrite: dryRun === true,
      });
    }

    case "patch_note": {
      const {
        content,
        createHeading,
        expectedSha256,
        heading,
        headingLevel = 2,
        operation,
        path: notePath,
      } = args as {
        content: string;
        createHeading?: boolean;
        expectedSha256?: string;
        heading: string;
        headingLevel?: number;
        operation: "append" | "prepend" | "replace";
        path: string;
      };
      const abs = resolveNote(notePath);
      const guarded = await assertExpectedSha256(abs, expectedSha256);
      const current = guarded ?? (await fsp.readFile(abs, "utf-8"));
      const next = patchHeadingContent(
        current,
        heading,
        operation,
        content,
        createHeading,
        headingLevel,
      );

      await fsp.writeFile(abs, next, "utf-8");
      return jsonResponse({
        operation,
        path: notePath,
        sha256: sha256(next),
      });
    }

    case "manage_frontmatter": {
      const { action, expectedSha256, key, path: notePath, value } = args as {
        action: "get" | "set" | "delete";
        expectedSha256?: string;
        key?: string;
        path: string;
        value?: JsonValue;
      };
      const abs = resolveNote(notePath);
      const guarded = await assertExpectedSha256(abs, expectedSha256);
      const current = guarded ?? (await fsp.readFile(abs, "utf-8"));
      const parsed = splitFrontmatter(current);

      if (action === "get") {
        return jsonResponse(key ? { [key]: parsed.frontmatter[key] } : parsed.frontmatter);
      }

      if (!key) throw new Error("key is required for set/delete");

      const nextFrontmatter = { ...parsed.frontmatter };
      if (action === "set") {
        nextFrontmatter[key] = value ?? null;
      } else {
        delete nextFrontmatter[key];
      }

      const next = replaceFrontmatter(current, nextFrontmatter);
      await fsp.writeFile(abs, next, "utf-8");
      return jsonResponse({
        frontmatter: nextFrontmatter,
        path: notePath,
        sha256: sha256(next),
      });
    }

    case "list_tags": {
      const { includeFiles, path: subPath } = args as {
        includeFiles?: boolean;
        path?: string;
      };
      return jsonResponse(await listAllTags({ includeFiles, path: subPath }));
    }

    case "manage_tags": {
      const {
        action,
        expectedSha256,
        location = "frontmatter",
        path: notePath,
        tags = [],
      } = args as {
        action: "list" | "add" | "remove";
        expectedSha256?: string;
        location?: "frontmatter" | "inline" | "both";
        path: string;
        tags?: string[];
      };
      const abs = resolveNote(notePath);
      const guarded = await assertExpectedSha256(abs, expectedSha256);
      const current = guarded ?? (await fsp.readFile(abs, "utf-8"));
      const parsed = splitFrontmatter(current);

      if (action === "list") {
        return jsonResponse({
          frontmatter: frontmatterTags(parsed.frontmatter),
          inline: inlineTags(parsed.body),
          tags: noteTags(current),
        });
      }

      const normalized = normalizeTags(tags);
      if (normalized.length === 0) {
        throw new Error("tags is required for add/remove");
      }

      const nextFrontmatter = { ...parsed.frontmatter };
      let nextBody = parsed.body;

      if (location === "frontmatter" || location === "both") {
        const currentTags = new Set(frontmatterTags(nextFrontmatter));
        if (action === "add") {
          for (const tag of normalized) currentTags.add(tag);
        } else {
          for (const tag of normalized) currentTags.delete(tag);
        }

        const sorted = [...currentTags].sort((a, b) => a.localeCompare(b));
        if (sorted.length > 0) {
          nextFrontmatter.tags = sorted;
        } else {
          delete nextFrontmatter.tags;
        }
      }

      if (location === "inline" || location === "both") {
        if (action === "add") {
          const existing = new Set(inlineTags(nextBody));
          const missing = normalized.filter((tag) => !existing.has(tag));
          if (missing.length > 0) {
            nextBody = `${nextBody.trimEnd()}\n\n${missing
              .map((tag) => `#${tag}`)
              .join(" ")}\n`;
          }
        } else {
          nextBody = removeInlineTagsFromBody(nextBody, normalized);
        }
      }

      const next = `${serializeFrontmatter(nextFrontmatter)}${nextBody}`;
      await fsp.writeFile(abs, next, "utf-8");
      return jsonResponse({
        path: notePath,
        sha256: sha256(next),
        tags: noteTags(next),
      });
    }

    case "get_periodic_note": {
      const { period } = args as { period: string };
      const now = new Date();
      let filename: string;
      switch (period) {
        case "daily":
          filename = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.md`;
          break;
        case "weekly": {
          const dayOfWeek = now.getDay();
          const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
          const monday = new Date(now);
          monday.setDate(diff);
          filename = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}.md`;
          break;
        }
        case "monthly":
          filename = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}.md`;
          break;
        case "quarterly": {
          const q = Math.floor(now.getMonth() / 3) + 1;
          filename = `${now.getFullYear()}-Q${q}.md`;
          break;
        }
        case "yearly":
          filename = `${now.getFullYear()}.md`;
          break;
        default:
          throw new Error(`Unknown period: ${period}`);
      }
      return textResponse(filename);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const resources: Array<{
    description: string;
    mimeType: string;
    name: string;
    size?: number;
    uri: string;
  }> = [
    {
      description: "Standalone server status and vault configuration",
      mimeType: JSON_MIME,
      name: "Markdown Vault MCP status",
      uri: "markdown-vault://status",
    },
    {
      description: "All vault tags with usage counts",
      mimeType: JSON_MIME,
      name: "Vault tags",
      uri: "markdown-vault://tags",
    },
  ];

  for (const relPath of await listMarkdownFiles()) {
    const stat = await fsp.stat(resolveNote(relPath));
    resources.push({
      description: `Markdown note: ${relPath}`,
      mimeType: JSON_MIME,
      name: relPath,
      uri: noteUri(relPath),
      size: stat.size,
    });
  }

  return { resources };
});

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [
    {
      description: "Read a markdown note by vault-relative path",
      mimeType: JSON_MIME,
      name: "Vault note",
      uriTemplate: "markdown-vault://vault/{path}",
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === "markdown-vault://status") {
    const files = await listMarkdownFiles();
    return {
      contents: [
        {
          mimeType: JSON_MIME,
          text: JSON.stringify(
            {
              capabilities: ["tools", "resources"],
              mode: "filesystem",
              noteCount: files.length,
              server: "markdown-vault-mcp-standalone",
              transport: "stdio",
              vaultPath: VAULT_ROOT,
              version: SERVER_VERSION,
            },
            null,
            2,
          ),
          uri,
        },
      ],
    };
  }

  if (uri === "markdown-vault://tags") {
    return {
      contents: [
        {
          mimeType: JSON_MIME,
          text: JSON.stringify(await listAllTags({ includeFiles: true }), null, 2),
          uri,
        },
      ],
    };
  }

  if (uri.startsWith("markdown-vault://vault/")) {
    const relPath = pathFromNoteUri(uri);
    return {
      contents: [
        {
          mimeType: JSON_MIME,
          text: JSON.stringify(await readNoteDetails(relPath), null, 2),
          uri,
        },
      ],
    };
  }

  throw new Error(`Unsupported resource URI: ${uri}`);
});

async function main() {
  if (!VAULT_PATH) {
    console.error("MARKDOWN_VAULT_PATH not set and no docs/ found.");
    console.error(
      "Set env var or place this server so that docs/ exists relative to it.",
    );
    process.exit(1);
  }
  if (!fs.existsSync(VAULT_PATH)) {
    console.error(`Vault path does not exist: ${VAULT_PATH}`);
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Markdown Vault MCP running - vault: ${VAULT_PATH}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === MODULE_PATH) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
