import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_DIAGNOSE_CHECKS,
  IGNORED_DIRS,
  MARKDOWN_EXTENSIONS,
  clampNumber,
  containsAnyToken,
  countTokenOccurrences,
  estimateTokens,
  isInside,
  isMarkdownPath,
  normalizeRelCandidate,
  normalizeText,
  stringArray,
  stripMarkdownExtension,
  toPosix,
  tokenize,
  trimToChars,
} from "./advanced-helpers.js";
import type {
  Frontmatter,
  FrontmatterParse,
  Heading,
  Issue,
  JsonValue,
  LinkGraph,
  LinkMatch,
  MarkdownNote,
  NoteIndex,
  RankedNote,
  ToolDefinition,
  Vault,
} from "./advanced-types.js";

export const advancedToolDefinitions: ToolDefinition[] = [
  {
    name: "obsidian_get_backlinks",
    description: "Find markdown files that reference a target note",
    inputSchema: {
      type: "object",
      properties: {
        includeContext: { type: "boolean" },
        path: {
          type: "string",
          description: "Target note path, with or without .md/.markdown",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "obsidian_impact_analysis",
    description: "Analyze a note before moving, renaming, or deleting it",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Note path to analyze" },
      },
      required: ["path"],
    },
  },
  {
    name: "obsidian_generate_index",
    description: "Generate or update a markdown index for a vault path",
    inputSchema: {
      type: "object",
      properties: {
        dryRun: { type: "boolean" },
        includeDescriptions: { type: "boolean" },
        mode: { type: "string", enum: ["hierarchical", "flat"] },
        overwrite: { type: "boolean" },
        path: { type: "string", description: "Directory to index" },
        target: { type: "string", description: "Index note to create or update" },
      },
      required: ["path", "target"],
    },
  },
  {
    name: "obsidian_diagnose_docs",
    description: "Run documentation diagnostics for agent-friendly markdown",
    inputSchema: {
      type: "object",
      properties: {
        checks: {
          type: "array",
          items: {
            type: "string",
            enum: [...DEFAULT_DIAGNOSE_CHECKS],
          },
        },
        path: { type: "string", description: "Directory or file to diagnose" },
      },
      required: ["path"],
    },
  },
  {
    name: "obsidian_extract_tasks",
    description: "Extract open TODO/FIXME/task checkbox items from markdown notes",
    inputSchema: {
      type: "object",
      properties: {
        groupBy: { type: "string", enum: ["file", "flat"] },
        includeDone: { type: "boolean" },
        path: { type: "string", description: "Directory or file to scan" },
      },
      required: ["path"],
    },
  },
  {
    name: "obsidian_build_context_pack",
    description: "Build a token-bounded markdown context pack for an AI agent task",
    inputSchema: {
      type: "object",
      properties: {
        exclude: { type: "array", items: { type: "string" } },
        include: { type: "array", items: { type: "string" } },
        maxTokens: { type: "number" },
        mode: { type: "string", enum: ["agent", "research", "summary"] },
        path: { type: "string", description: "Base path to search" },
        topic: { type: "string" },
      },
      required: ["topic"],
    },
  },
  {
    name: "obsidian_find_relevant_notes",
    description: "Rank notes by agent-oriented heuristic relevance",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        path: { type: "string" },
        query: { type: "string" },
        strategy: { type: "string", enum: ["hybrid", "literal"] },
      },
      required: ["query"],
    },
  },
  {
    name: "obsidian_safe_rename_note",
    description: "Rename a note and optionally update internal markdown/wiki links",
    inputSchema: {
      type: "object",
      properties: {
        dryRun: { type: "boolean" },
        from: { type: "string" },
        to: { type: "string" },
        updateLinks: { type: "boolean" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "obsidian_lint_markdown_vault",
    description: "Lint a markdown vault for AI-agent documentation quality",
    inputSchema: {
      type: "object",
      properties: {
        dryRun: { type: "boolean" },
        fix: { type: "boolean" },
        path: { type: "string" },
      },
      required: ["path"],
    },
  },
  {
    name: "obsidian_generate_agent_briefing",
    description: "Generate a concise task briefing for an AI agent",
    inputSchema: {
      type: "object",
      properties: {
        maxTokens: { type: "number" },
        path: { type: "string" },
        task: { type: "string" },
      },
      required: ["task"],
    },
  },
];

export function isAdvancedTool(name: string): boolean {
  return advancedToolDefinitions.some((tool) => tool.name === name);
}

export async function callAdvancedTool(
  name: string,
  args: Record<string, unknown>,
  vaultRoot: string,
): Promise<unknown> {
  switch (name) {
    case "obsidian_get_backlinks":
      return getBacklinks(vaultRoot, args);
    case "obsidian_impact_analysis":
      return impactAnalysis(vaultRoot, args);
    case "obsidian_generate_index":
      return generateIndex(vaultRoot, args);
    case "obsidian_diagnose_docs":
      return diagnoseDocs(vaultRoot, args);
    case "obsidian_extract_tasks":
      return extractTasks(vaultRoot, args);
    case "obsidian_build_context_pack":
      return buildContextPack(vaultRoot, args);
    case "obsidian_find_relevant_notes":
      return findRelevantNotes(vaultRoot, args);
    case "obsidian_safe_rename_note":
      return safeRenameNote(vaultRoot, args);
    case "obsidian_lint_markdown_vault":
      return lintMarkdownVault(vaultRoot, args);
    case "obsidian_generate_agent_briefing":
      return generateAgentBriefing(vaultRoot, args);
    default:
      throw new Error(`Unknown advanced tool: ${name}`);
  }
}

async function createVault(root: string): Promise<Vault> {
  if (!root) throw new Error("Vault path is not configured");
  const resolved = path.resolve(root);
  const realRoot = await fsp.realpath(resolved);
  return { realRoot, root: resolved };
}

function relativePath(vault: Vault, abs: string): string {
  return toPosix(path.relative(vault.root, abs));
}

async function assertRealPathInside(vault: Vault, abs: string): Promise<void> {
  let cursor = abs;

  while (true) {
    try {
      const real = await fsp.realpath(cursor);
      if (!isInside(vault.realRoot, real)) {
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

async function resolveVaultPath(vault: Vault, input = ""): Promise<string> {
  const abs = path.isAbsolute(input)
    ? path.resolve(input)
    : path.resolve(vault.root, input);
  if (!isInside(vault.root, abs)) {
    throw new Error("Refusing to access path outside vault. Path traversal denied.");
  }
  await assertRealPathInside(vault, abs);
  return abs;
}

async function lstatMaybe(abs: string): Promise<fs.Stats | undefined> {
  try {
    return await fsp.lstat(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw err;
  }
}

async function fileExists(abs: string): Promise<boolean> {
  const stat = await lstatMaybe(abs);
  return Boolean(stat);
}

async function resolveMarkdownFile(
  vault: Vault,
  input: string,
  options: { mustExist?: boolean } = {},
): Promise<{ abs: string; exists: boolean; rel: string }> {
  if (!input || typeof input !== "string") {
    throw new Error("path is required");
  }

  const normalizedInput = input.replace(/\\/g, "/");
  const ext = path.posix.extname(normalizedInput).toLowerCase();
  if (ext && !MARKDOWN_EXTENSIONS.has(ext)) {
    throw new Error("Only .md and .markdown note files are supported");
  }

  const candidates = ext
    ? [normalizedInput]
    : [`${normalizedInput}.md`, `${normalizedInput}.markdown`];

  for (const candidate of candidates) {
    const abs = await resolveVaultPath(vault, candidate);
    const stat = await lstatMaybe(abs);
    if (!stat) continue;
    if (!stat.isFile()) {
      throw new Error(`Markdown note is not a file: ${candidate}`);
    }
    return { abs, exists: true, rel: relativePath(vault, abs) };
  }

  if (options.mustExist) {
    throw new Error(`File not found inside vault: ${input}`);
  }

  const fallback = candidates[0];
  const abs = await resolveVaultPath(vault, fallback);
  return { abs, exists: false, rel: relativePath(vault, abs) };
}

async function* walkMarkdownFiles(
  vault: Vault,
  rootAbs: string,
): AsyncGenerator<string> {
  const stat = await lstatMaybe(rootAbs);
  if (!stat) return;
  if (stat.isSymbolicLink()) return;

  if (stat.isFile()) {
    if (isMarkdownPath(rootAbs)) yield rootAbs;
    return;
  }

  if (!stat.isDirectory()) return;

  const entries = await fsp.readdir(rootAbs, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(rootAbs, entry.name);
    if (entry.isDirectory()) {
      yield* walkMarkdownFiles(vault, full);
    } else if (entry.isFile() && isMarkdownPath(entry.name)) {
      await assertRealPathInside(vault, full);
      yield full;
    }
  }
}

async function listMarkdownFileRefs(
  vault: Vault,
  inputPath = "",
): Promise<Array<{ abs: string; rel: string }>> {
  const rootAbs = await resolveVaultPath(vault, inputPath);
  const stat = await lstatMaybe(rootAbs);
  if (!stat) throw new Error(`Path not found: ${inputPath || "."}`);
  if (stat.isFile() && !isMarkdownPath(rootAbs)) {
    throw new Error("Only .md and .markdown note files are supported");
  }

  const files: Array<{ abs: string; rel: string }> = [];
  for await (const abs of walkMarkdownFiles(vault, rootAbs)) {
    files.push({ abs, rel: relativePath(vault, abs) });
  }
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

async function loadMarkdownNote(
  vault: Vault,
  ref: { abs: string; rel: string },
): Promise<MarkdownNote> {
  await assertRealPathInside(vault, ref.abs);
  const content = await fsp.readFile(ref.abs, "utf-8");
  const parsed = splitFrontmatter(content);
  const headings = extractHeadings(content);
  const h1 = headings.find((heading) => heading.level === 1);

  return {
    abs: ref.abs,
    body: parsed.body,
    charCount: content.length,
    content,
    frontmatter: parsed.frontmatter,
    hasFrontmatter: parsed.hasFrontmatter,
    headings,
    lineCount: content.split(/\r?\n/).length,
    links: extractLinks(content),
    rawFrontmatter: parsed.rawFrontmatter,
    rel: ref.rel,
    tags: noteTags(content),
    title: h1?.text ?? null,
    yamlError: parsed.yamlError,
  };
}

async function loadMarkdownNotes(
  vault: Vault,
  inputPath = "",
): Promise<MarkdownNote[]> {
  const refs = await listMarkdownFileRefs(vault, inputPath);
  return Promise.all(refs.map((ref) => loadMarkdownNote(vault, ref)));
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

  if (current.trim() || value.endsWith(",")) items.push(current.trim());
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

function validateSimpleYaml(raw: string): string | undefined {
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (/^\s/.test(line)) continue;
    if (!/^[A-Za-z0-9_-]+:(?:\s+.*)?$/.test(line)) {
      return `Invalid frontmatter line ${i + 1}: ${line}`;
    }
  }
  return undefined;
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

function splitFrontmatter(content: string): FrontmatterParse {
  if (!content.startsWith("---")) {
    return {
      body: content,
      frontmatter: {},
      hasFrontmatter: false,
      rawFrontmatter: "",
    };
  }

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return {
      body: content,
      frontmatter: {},
      hasFrontmatter: true,
      rawFrontmatter: content.replace(/^---\r?\n?/, ""),
      yamlError: "Unclosed frontmatter block",
    };
  }

  const yamlError = validateSimpleYaml(match[1]);
  return {
    body: content.slice(match[0].length),
    frontmatter: parseFrontmatter(match[1]),
    hasFrontmatter: true,
    rawFrontmatter: match[1],
    yamlError,
  };
}

function extractHeadings(content: string): Heading[] {
  const lines = content.split(/\r?\n/);
  const headings: Heading[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (!match) continue;
    headings.push({
      level: match[1].length,
      line: i + 1,
      text: match[2].trim(),
    });
  }

  return headings;
}

function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, "");
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map(normalizeTag).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function tagsFromFrontmatter(frontmatter: Frontmatter): string[] {
  const values = [frontmatter.tags, frontmatter.tag];
  const tags: string[] = [];

  for (const value of values) {
    if (Array.isArray(value)) {
      tags.push(
        ...value
          .filter((item): item is string => typeof item === "string")
          .flatMap((item) => item.split(/[\s,]+/)),
      );
    } else if (typeof value === "string") {
      tags.push(...value.split(/[\s,]+/));
    }
  }

  return normalizeTags(tags);
}

function inlineTags(body: string): string[] {
  const tags: string[] = [];
  const re = /(^|[\s([{])#([A-Za-z0-9_/-]+)\b/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) tags.push(match[2]);
  return normalizeTags(tags);
}

function noteTags(content: string): string[] {
  const parsed = splitFrontmatter(content);
  return normalizeTags([
    ...tagsFromFrontmatter(parsed.frontmatter),
    ...inlineTags(parsed.body),
  ]);
}

function splitWikiTarget(value: string): { alias?: string; pathPart: string } {
  const [target, alias] = value.split("|", 2);
  return {
    alias: alias?.trim(),
    pathPart: target.trim(),
  };
}

function stripLinkDecorations(target: string): string {
  let next = target.trim();
  if (next.startsWith("<") && next.endsWith(">")) next = next.slice(1, -1);
  next = next.replace(/\s+["'][^"']*["']$/, "");
  try {
    next = decodeURI(next);
  } catch {
    return next;
  }
  return next;
}

function isExternalLink(target: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target);
}

function removeAnchorAndQuery(target: string): string {
  const hashIndex = target.indexOf("#");
  const queryIndex = target.indexOf("?");
  const cut = [hashIndex, queryIndex]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  return cut === undefined ? target : target.slice(0, cut);
}

function extractLinks(content: string): LinkMatch[] {
  const links: LinkMatch[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let wikiMatch: RegExpExecArray | null;
    const wikiRe = /\[\[([^\]\n]+)\]\]/g;
    while ((wikiMatch = wikiRe.exec(line)) !== null) {
      const parsed = splitWikiTarget(wikiMatch[1]);
      links.push({
        alias: parsed.alias,
        line: i + 1,
        raw: wikiMatch[0],
        target: parsed.pathPart,
        text: line,
        type: "wikilink",
      });
    }

    let mdMatch: RegExpExecArray | null;
    const mdRe = /(!?)\[([^\]\n]*)\]\(([^)\n]+)\)/g;
    while ((mdMatch = mdRe.exec(line)) !== null) {
      if (mdMatch[1] === "!") continue;
      const href = stripLinkDecorations(mdMatch[3]);
      if (isExternalLink(href) || href.startsWith("#")) continue;
      links.push({
        href,
        line: i + 1,
        raw: mdMatch[0],
        target: href,
        text: line,
        type: "markdown",
      });
    }
  }

  return links;
}

function createNoteIndex(notes: MarkdownNote[]): NoteIndex {
  const byRel = new Map<string, MarkdownNote>();
  const byRelNoExt = new Map<string, string>();
  const byBasenameNoExt = new Map<string, string[]>();
  const relNoExtByRel = new Map<string, string>();

  for (const note of notes) {
    byRel.set(note.rel, note);
    const noExt = stripMarkdownExtension(note.rel).toLowerCase();
    relNoExtByRel.set(note.rel, noExt);
    byRelNoExt.set(noExt, note.rel);
    const basename = path.posix.basename(noExt);
    const entries = byBasenameNoExt.get(basename) ?? [];
    entries.push(note.rel);
    byBasenameNoExt.set(basename, entries);
  }

  return { byBasenameNoExt, byRel, byRelNoExt, relNoExtByRel };
}

function linkLookupKeys(link: LinkMatch, sourceRel: string): string[] {
  const rawTarget =
    link.type === "wikilink"
      ? splitWikiTarget(link.target).pathPart
      : stripLinkDecorations(link.href ?? link.target);
  const cleanTarget = removeAnchorAndQuery(rawTarget);
  if (!cleanTarget || cleanTarget.startsWith("#") || isExternalLink(cleanTarget)) {
    return [];
  }

  const ext = path.posix.extname(cleanTarget).toLowerCase();
  if (ext && !MARKDOWN_EXTENSIONS.has(ext)) return [];

  const targetNoExt = stripMarkdownExtension(cleanTarget.replace(/\\/g, "/"));
  const sourceDir = path.posix.dirname(sourceRel);
  const candidates =
    link.type === "markdown"
      ? [
          path.posix.join(sourceDir === "." ? "" : sourceDir, targetNoExt),
          targetNoExt,
        ]
      : [
          path.posix.join(sourceDir === "." ? "" : sourceDir, targetNoExt),
          targetNoExt,
        ];

  const keys = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeRelCandidate(candidate);
    if (normalized) keys.add(normalized.toLowerCase());
  }

  return [...keys];
}

function linkRawNoExt(link: LinkMatch): string | undefined {
  const target =
    link.type === "wikilink"
      ? splitWikiTarget(link.target).pathPart
      : stripLinkDecorations(link.href ?? link.target);
  const cleanTarget = removeAnchorAndQuery(target);
  if (!cleanTarget || cleanTarget.startsWith("#") || isExternalLink(cleanTarget)) {
    return undefined;
  }
  const ext = path.posix.extname(cleanTarget).toLowerCase();
  if (ext && !MARKDOWN_EXTENSIONS.has(ext)) return undefined;
  const normalized = normalizeRelCandidate(stripMarkdownExtension(cleanTarget));
  return normalized?.toLowerCase();
}

function resolveLink(
  link: LinkMatch,
  sourceRel: string,
  index: NoteIndex,
): string | undefined {
  for (const key of linkLookupKeys(link, sourceRel)) {
    const exact = index.byRelNoExt.get(key);
    if (exact) return exact;
  }

  const raw = linkRawNoExt(link);
  if (!raw) return undefined;

  const basename = path.posix.basename(raw);
  const basenameMatches = index.byBasenameNoExt.get(basename) ?? [];
  if (!raw.includes("/") && basenameMatches.length === 1) return basenameMatches[0];

  const suffixMatches = [...index.byRelNoExt.entries()]
    .filter(([key]) => key === raw || key.endsWith(`/${raw}`))
    .map(([, rel]) => rel);
  if (suffixMatches.length === 1) return suffixMatches[0];

  return undefined;
}

function linkExists(link: LinkMatch, sourceRel: string, index: NoteIndex): boolean {
  if (resolveLink(link, sourceRel, index)) return true;
  const raw = linkRawNoExt(link);
  if (!raw) return true;
  const basename = path.posix.basename(raw);
  if (!raw.includes("/") && (index.byBasenameNoExt.get(basename)?.length ?? 0) > 0) {
    return true;
  }
  return [...index.byRelNoExt.keys()].some(
    (key) => key === raw || key.endsWith(`/${raw}`),
  );
}

function linkMatchesTarget(
  link: LinkMatch,
  sourceRel: string,
  targetRel: string,
  index: NoteIndex,
): boolean {
  const resolved = resolveLink(link, sourceRel, index);
  if (resolved) return resolved === targetRel;

  const raw = linkRawNoExt(link);
  if (!raw) return false;
  const targetNoExt = stripMarkdownExtension(targetRel).toLowerCase();
  const targetBase = path.posix.basename(targetNoExt);
  return raw === targetNoExt || raw === targetBase || targetNoExt.endsWith(`/${raw}`);
}

function buildGraph(notes: MarkdownNote[], index: NoteIndex): LinkGraph {
  const outgoing = new Map<string, Set<string>>();
  const backlinks = new Map<string, Map<string, LinkMatch[]>>();

  for (const note of notes) {
    const out = outgoing.get(note.rel) ?? new Set<string>();
    for (const link of note.links) {
      const resolved = resolveLink(link, note.rel, index);
      if (!resolved || resolved === note.rel) continue;
      out.add(resolved);
      const bySource = backlinks.get(resolved) ?? new Map<string, LinkMatch[]>();
      const matches = bySource.get(note.rel) ?? [];
      matches.push(link);
      bySource.set(note.rel, matches);
      backlinks.set(resolved, bySource);
    }
    outgoing.set(note.rel, out);
  }

  return { backlinks, outgoing };
}

function firstParagraph(body: string): string {
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

function descriptionFor(note: MarkdownNote): string {
  const description = note.frontmatter.description;
  if (typeof description === "string" && description.trim()) {
    return description.trim();
  }
  return firstParagraph(note.body);
}

function fallbackTitle(note: MarkdownNote): string {
  return note.title ?? path.posix.basename(stripMarkdownExtension(note.rel));
}

function snippetFor(note: MarkdownNote, tokens: string[], maxChars = 700): string {
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

function addMatchedBy(matchedBy: Set<string>, value: string): void {
  matchedBy.add(value);
}

function rankLoadedNotes(
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

async function getBacklinks(root: string, args: Record<string, unknown>) {
  const vault = await createVault(root);
  const notePath = String(args.path ?? "");
  const includeContext = args.includeContext !== false;
  const target = await resolveMarkdownFile(vault, notePath);
  const notes = await loadMarkdownNotes(vault);
  const index = createNoteIndex(notes);
  const backlinks = [];

  for (const note of notes) {
    if (note.rel === target.rel) continue;
    const matches = note.links
      .filter((link) => linkMatchesTarget(link, note.rel, target.rel, index))
      .map((link) => ({
        line: link.line,
        ...(includeContext ? { text: link.text } : {}),
      }));
    if (matches.length > 0) backlinks.push({ matches, path: note.rel });
  }

  return {
    backlinks,
    count: backlinks.length,
    target: target.rel,
  };
}

async function impactAnalysis(root: string, args: Record<string, unknown>) {
  const vault = await createVault(root);
  const notePath = String(args.path ?? "");
  const target = await resolveMarkdownFile(vault, notePath);

  if (!target.exists) {
    return {
      backlinks: [],
      exists: false,
      frontmatter: {},
      outgoingLinks: [],
      path: target.rel,
      risks: ["This note does not exist."],
      tags: [],
      title: null,
    };
  }

  const notes = await loadMarkdownNotes(vault);
  const index = createNoteIndex(notes);
  const graph = buildGraph(notes, index);
  const note = index.byRel.get(target.rel);
  if (!note) throw new Error(`File not found inside vault: ${notePath}`);

  const backlinks = [...(graph.backlinks.get(note.rel)?.keys() ?? [])].sort();
  const outgoingLinks = [...(graph.outgoing.get(note.rel) ?? new Set<string>())].sort();
  const risks: string[] = [];
  if (backlinks.length > 0) {
    risks.push(`This note is referenced by ${backlinks.length} files.`);
    risks.push("Deleting or moving it may break links.");
  }
  if (outgoingLinks.length > 0) {
    risks.push(`This note points to ${outgoingLinks.length} internal notes.`);
  }
  if (!note.title) risks.push("This note has no H1 title.");

  return {
    backlinks,
    exists: true,
    frontmatter: note.frontmatter,
    outgoingLinks,
    path: note.rel,
    risks,
    tags: note.tags,
    title: note.title,
  };
}

async function generateIndex(root: string, args: Record<string, unknown>) {
  const vault = await createVault(root);
  const inputPath = String(args.path ?? "");
  const targetPath = String(args.target ?? "");
  const includeDescriptions = args.includeDescriptions === true;
  const mode = args.mode === "flat" ? "flat" : "hierarchical";
  const overwrite = args.overwrite === true;
  const dryRun = args.dryRun === true;
  const target = await resolveMarkdownFile(vault, targetPath);

  if (target.exists && !overwrite && !dryRun) {
    throw new Error(
      `Index target already exists. Use overwrite: true or dryRun: true. Target: ${target.rel}`,
    );
  }

  const scanRoot = await resolveVaultPath(vault, inputPath);
  const baseRel = relativePath(vault, scanRoot);
  const notes = (await loadMarkdownNotes(vault, inputPath)).filter(
    (note) => note.rel !== target.rel,
  );
  const content = buildIndexContent(notes, target.rel, baseRel, {
    includeDescriptions,
    mode,
  });

  if (dryRun) {
    const contentPreview = trimToChars(content, 8000);
    return {
      contentPreview,
      dryRun: true,
      filesIndexed: notes.length,
      previewTruncated: contentPreview !== content,
      target: target.rel,
      wouldCreate: !target.exists,
      wouldUpdate: target.exists,
    };
  }

  await fsp.mkdir(path.dirname(target.abs), { recursive: true });
  await assertRealPathInside(vault, path.dirname(target.abs));
  await fsp.writeFile(target.abs, content, "utf-8");

  return {
    created: !target.exists,
    filesIndexed: notes.length,
    target: target.rel,
    updated: target.exists,
  };
}

function buildIndexContent(
  notes: MarkdownNote[],
  targetRel: string,
  baseRel: string,
  options: { includeDescriptions: boolean; mode: "flat" | "hierarchical" },
): string {
  const title = "# Índice da documentação";
  const targetDir = path.posix.dirname(targetRel);
  const sorted = [...notes].sort((a, b) => a.rel.localeCompare(b.rel));
  const itemFor = (note: MarkdownNote) => {
    const link = wikilinkBetween(targetDir, note.rel);
    const label = indexLabelFor(note, options.includeDescriptions);
    return label ? `- [[${link}]] — ${label}` : `- [[${link}]]`;
  };

  if (options.mode === "flat") {
    return `${title}\n\n${sorted.map(itemFor).join("\n")}\n`;
  }

  const groups = new Map<string, MarkdownNote[]>();
  const normalizedBase = baseRel === "" ? "" : `${baseRel.replace(/\/$/, "")}/`;
  for (const note of sorted) {
    const relToBase = note.rel.startsWith(normalizedBase)
      ? note.rel.slice(normalizedBase.length)
      : note.rel;
    const dirname = path.posix.dirname(relToBase);
    const group = dirname === "." ? "Notas" : dirname.split("/")[0];
    const entries = groups.get(group) ?? [];
    entries.push(note);
    groups.set(group, entries);
  }

  const sections = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, groupNotes]) => `## ${group}\n\n${groupNotes.map(itemFor).join("\n")}`);

  return `${title}\n\n${sections.join("\n\n")}\n`;
}

function indexLabelFor(note: MarkdownNote, includeDescription: boolean): string {
  const title = fallbackTitle(note);
  if (!includeDescription) return title;

  const description = descriptionFor(note);
  if (!description || isSimilarText(title, description)) return title;
  return `${title} — ${description}`;
}

function isSimilarText(left: string, right: string): boolean {
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

function wikilinkBetween(sourceDir: string, destRel: string): string {
  const destNoExt = stripMarkdownExtension(destRel);
  const rel = path.posix.relative(sourceDir === "." ? "" : sourceDir, destNoExt);
  return rel.replace(/^\.\//, "");
}

async function diagnoseDocs(root: string, args: Record<string, unknown>) {
  const vault = await createVault(root);
  const inputPath = String(args.path ?? "");
  const requested = Array.isArray(args.checks)
    ? args.checks.filter((check): check is string => typeof check === "string")
    : [...DEFAULT_DIAGNOSE_CHECKS];
  const checks = new Set(requested);
  const notes = await loadMarkdownNotes(vault, inputPath);
  const allNotes = inputPath ? await loadMarkdownNotes(vault) : notes;
  const issues = buildDiagnosticIssues(notes, checks, allNotes);

  return {
    issues,
    path: inputPath,
    summary: {
      filesScanned: notes.length,
      issuesFound: issues.length,
    },
  };
}

function buildDiagnosticIssues(
  notes: MarkdownNote[],
  checks: Set<string>,
  allNotes = notes,
): Issue[] {
  const issues: Issue[] = [];
  const index = createNoteIndex(allNotes);
  const graph = buildGraph(allNotes, index);

  if (checks.has("broken_links")) addBrokenLinkIssues(notes, index, issues);
  if (checks.has("broken_anchors")) addBrokenAnchorIssues(notes, index, issues);
  if (checks.has("missing_titles")) addMissingTitleIssues(notes, issues);
  if (checks.has("duplicate_titles")) addDuplicateTitleIssues(notes, issues);
  if (checks.has("empty_files")) addEmptyFileIssues(notes, issues);
  if (checks.has("orphan_notes")) addOrphanIssues(notes, graph, issues);
  if (checks.has("missing_frontmatter")) addMissingFrontmatterIssues(notes, issues);
  if (checks.has("large_files")) addLargeFileIssues(notes, issues);

  return issues.sort(issueSort);
}

function addBrokenLinkIssues(
  notes: MarkdownNote[],
  index: NoteIndex,
  issues: Issue[],
): void {
  for (const note of notes) {
    for (const link of note.links) {
      if (linkExists(link, note.rel, index)) continue;
      issues.push({
        file: note.rel,
        line: link.line,
        message: `Link points to missing note: ${link.target}`,
        severity: "error",
        type: "broken_links",
      });
    }
  }
}

function addBrokenAnchorIssues(
  notes: MarkdownNote[],
  index: NoteIndex,
  issues: Issue[],
): void {
  for (const note of notes) {
    for (const link of note.links) {
      const anchor = linkAnchor(link);
      if (!anchor) continue;

      const resolved = resolveLink(link, note.rel, index);
      if (!resolved) continue;

      const target = index.byRel.get(resolved);
      if (!target || hasHeadingAnchor(target, anchor)) continue;

      issues.push({
        file: note.rel,
        line: link.line,
        message: `Link points to existing note but missing heading: ${resolved}#${anchor}`,
        severity: "warning",
        type: "broken_anchors",
      });
    }
  }
}

function linkAnchor(link: LinkMatch): string | undefined {
  const rawTarget =
    link.type === "wikilink"
      ? splitWikiTarget(link.target).pathPart
      : stripLinkDecorations(link.href ?? link.target);
  const hashIndex = rawTarget.indexOf("#");
  if (hashIndex < 0) return undefined;

  const rawAnchor = rawTarget.slice(hashIndex + 1).split("?")[0].trim();
  if (!rawAnchor) return undefined;
  try {
    return decodeURI(rawAnchor);
  } catch {
    return rawAnchor;
  }
}

function hasHeadingAnchor(note: MarkdownNote, anchor: string): boolean {
  const wantedSlug = headingSlug(anchor);
  const wantedText = normalizedHeadingText(anchor);
  return note.headings.some((heading) => {
    return (
      headingSlug(heading.text) === wantedSlug ||
      normalizedHeadingText(heading.text) === wantedText
    );
  });
}

function headingSlug(value: string): string {
  return normalizeText(value)
    .replace(/&[a-z0-9]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function normalizedHeadingText(value: string): string {
  return normalizeText(value)
    .replace(/[-_]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addMissingTitleIssues(notes: MarkdownNote[], issues: Issue[]): void {
  for (const note of notes) {
    if (note.title) continue;
    issues.push({
      file: note.rel,
      message: "File has no H1 title.",
      severity: "warning",
      type: "missing_titles",
    });
  }
}

function addDuplicateTitleIssues(notes: MarkdownNote[], issues: Issue[]): void {
  const titles = new Map<string, MarkdownNote[]>();
  for (const note of notes) {
    if (!note.title) continue;
    const key = normalizeText(note.title);
    const entries = titles.get(key) ?? [];
    entries.push(note);
    titles.set(key, entries);
  }

  for (const entries of titles.values()) {
    if (entries.length < 2) continue;
    const files = entries.map((note) => note.rel).join(", ");
    for (const note of entries) {
      issues.push({
        file: note.rel,
        line: note.headings.find((heading) => heading.level === 1)?.line,
        message: `Duplicate H1 title "${note.title}" also appears in: ${files}`,
        severity: "warning",
        type: "duplicate_titles",
      });
    }
  }
}

function addEmptyFileIssues(notes: MarkdownNote[], issues: Issue[]): void {
  for (const note of notes) {
    const compact = note.body.replace(/\s+/g, "");
    if (compact.length > 10) continue;
    issues.push({
      file: note.rel,
      message: "File is empty or almost empty.",
      severity: "warning",
      type: "empty_files",
    });
  }
}

function isOrphanException(rel: string): boolean {
  const base = path.posix.basename(rel).toLowerCase();
  return base === "index.md" || base === "readme.md" || base === "agents.md";
}

function addOrphanIssues(
  notes: MarkdownNote[],
  graph: LinkGraph,
  issues: Issue[],
): void {
  for (const note of notes) {
    if (isOrphanException(note.rel)) continue;
    if ((graph.backlinks.get(note.rel)?.size ?? 0) > 0) continue;
    issues.push({
      file: note.rel,
      message: "Note is not referenced by any other scanned note.",
      severity: "warning",
      type: "orphan_notes",
    });
  }
}

function addMissingFrontmatterIssues(notes: MarkdownNote[], issues: Issue[]): void {
  for (const note of notes) {
    if (note.hasFrontmatter) continue;
    issues.push({
      file: note.rel,
      message: "File has no YAML frontmatter.",
      severity: "warning",
      type: "missing_frontmatter",
    });
  }
}

function addLargeFileIssues(notes: MarkdownNote[], issues: Issue[]): void {
  for (const note of notes) {
    if (note.lineCount <= 800 && note.charCount <= 30000) continue;
    issues.push({
      file: note.rel,
      message: "File is large for efficient AI context (>800 lines or >30000 chars).",
      severity: "warning",
      type: "large_files",
    });
  }
}

function issueSort(a: Issue, b: Issue): number {
  return (
    (a.file ?? "").localeCompare(b.file ?? "") ||
    (a.line ?? 0) - (b.line ?? 0) ||
    a.type.localeCompare(b.type)
  );
}

async function extractTasks(root: string, args: Record<string, unknown>) {
  const vault = await createVault(root);
  const inputPath = String(args.path ?? "");
  const includeDone = args.includeDone === true;
  const groupBy = args.groupBy === "flat" ? "flat" : "file";
  const notes = await loadMarkdownNotes(vault, inputPath);
  const tasks = [];

  for (const note of notes) {
    const lines = note.content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const checkbox = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/);
      if (checkbox) {
        const done = checkbox[1].toLowerCase() === "x";
        if (!done || includeDone) {
          tasks.push({
            done,
            file: note.rel,
            line: i + 1,
            text: checkbox[2].trim(),
          });
        }
        continue;
      }

      const todo = line.match(/\b(TODO|FIXME):?\s+(.+)$/i) ?? line.match(/@todo\b:?\s*(.+)$/i);
      if (todo) {
        tasks.push({
          done: false,
          file: note.rel,
          line: i + 1,
          text: todo[0].trim(),
        });
      }
    }
  }

  if (groupBy === "flat") {
    return {
      count: tasks.length,
      path: inputPath,
      tasks,
    };
  }

  const grouped = new Map<string, typeof tasks>();
  for (const task of tasks) {
    const entries = grouped.get(task.file) ?? [];
    entries.push(task);
    grouped.set(task.file, entries);
  }

  return {
    count: tasks.length,
    groups: [...grouped.entries()].map(([file, fileTasks]) => ({
      file,
      tasks: fileTasks,
    })),
    path: inputPath,
    tasks,
  };
}

async function findRelevantNotes(root: string, args: Record<string, unknown>) {
  const vault = await createVault(root);
  const query = String(args.query ?? "");
  const inputPath = typeof args.path === "string" ? args.path : "";
  const limit = clampNumber(args.limit, 10, 1, 50);
  const notes = await loadMarkdownNotes(vault, inputPath);
  const index = createNoteIndex(notes);
  const graph = buildGraph(notes, index);
  const ranked = rankLoadedNotes(notes, query, graph, index).slice(0, limit);

  return {
    query,
    results: ranked.map((entry) => ({
      matchedBy: entry.matchedBy,
      path: entry.note.rel,
      score: entry.score,
      snippet: entry.snippet,
      title: entry.note.title,
    })),
  };
}

async function buildContextPack(root: string, args: Record<string, unknown>) {
  const vault = await createVault(root);
  const topic = String(args.topic ?? "");
  const inputPath = typeof args.path === "string" ? args.path : "";
  const maxTokens = clampNumber(args.maxTokens, 12000, 500, 100000);
  const include = stringArray(args.include);
  const exclude = stringArray(args.exclude);
  const notes = await loadCandidateNotes(vault, inputPath, include, exclude);
  const index = createNoteIndex(notes);
  const graph = buildGraph(notes, index);
  const ranked = prioritizeContextPackFiles(
    rankLoadedNotes(notes, topic, graph, index),
    notes,
  );
  const selected = selectNotesForBudget(ranked, topic, maxTokens);
  const content = buildContextPackContent(topic, selected, maxTokens);

  return {
    content,
    estimatedTokens: estimateTokens(content),
    filesUsed: selected.map((entry) => entry.note.rel),
    topic,
  };
}

async function loadCandidateNotes(
  vault: Vault,
  inputPath: string,
  include: string[],
  exclude: string[],
): Promise<MarkdownNote[]> {
  const allRefs = await listMarkdownFileRefs(vault);
  const refs = include.length > 0 ? allRefs : await listMarkdownFileRefs(vault, inputPath);
  const includeMatchers = include.map(globMatcher);
  const excludeMatchers = exclude.map(globMatcher);
  const isExcluded = (rel: string) => excludeMatchers.some((matches) => matches(rel));
  const filtered = refs.filter((ref) => {
    const included =
      includeMatchers.length === 0 || includeMatchers.some((matches) => matches(ref.rel));
    return included && !isExcluded(ref.rel);
  });
  const byRel = new Map(filtered.map((ref) => [ref.rel, ref]));

  for (const ref of centralContextRefs(allRefs, inputPath)) {
    if (!isExcluded(ref.rel)) byRel.set(ref.rel, ref);
  }

  return Promise.all([...byRel.values()].map((ref) => loadMarkdownNote(vault, ref)));
}

function centralContextRefs(
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

function isWithinInputPath(rel: string, inputPath: string): boolean {
  const normalized = path.posix
    .normalize(inputPath.replace(/\\/g, "/"))
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
  if (!normalized || normalized === ".") return true;
  if (isMarkdownPath(normalized)) return rel === normalized;
  return rel === normalized || rel.startsWith(`${normalized}/`);
}

function prioritizeContextPackFiles(
  ranked: RankedNote[],
  notes: MarkdownNote[],
): RankedNote[] {
  const byRel = new Map(ranked.map((entry) => [entry.note.rel, entry]));
  const ordered: RankedNote[] = [];
  const push = (note: MarkdownNote, score: number, matchedBy: string[]) => {
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
    .sort((a, b) => b.score - a.score || a.note.rel.localeCompare(b.note.rel));

  for (const entry of central) {
    push(entry.note, entry.score, [centralContextMatch(entry.note.rel)]);
  }
  for (const entry of ranked) push(entry.note, entry.score, entry.matchedBy);
  return ordered;
}

function centralContextScore(rel: string): number {
  const lower = rel.toLowerCase();
  const basename = path.posix.basename(lower);
  if (basename === "agents.md") return 100;
  if (basename === "readme.md") return 95;
  if (lower === "docs/index.md") return 92;
  if (basename === "index.md" || basename === "index.markdown") return 90;
  return 0;
}

function centralContextMatch(rel: string): string {
  const lower = rel.toLowerCase();
  if (path.posix.basename(lower) === "agents.md") return "agents";
  if (path.posix.basename(lower) === "readme.md") return "readme";
  return "index";
}

function globMatcher(pattern: string): (value: string) => boolean {
  const normalized = pattern.replace(/\\/g, "/");
  if (!/[*?[\]{}]/.test(normalized)) {
    return (value) => value === normalized;
  }

  let source = "^";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];
    const nextNext = normalized[i + 2];
    if (char === "*" && next === "*" && nextNext === "/") {
      source += "(?:.*/)?";
      i += 2;
    } else if (char === "*" && next === "*") {
      source += ".*";
      i += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  source += "$";
  const re = new RegExp(source);
  return (value) => re.test(value);
}

function selectNotesForBudget(
  ranked: RankedNote[],
  topic: string,
  maxTokens: number,
): RankedNote[] {
  const selected: RankedNote[] = [];
  for (const entry of ranked) {
    const candidate = [...selected, entry];
    const content = buildContextPackContent(topic, candidate, maxTokens);
    if (estimateTokens(content) <= maxTokens || selected.length === 0) {
      selected.push(entry);
    }
    if (estimateTokens(buildContextPackContent(topic, selected, maxTokens)) >= maxTokens) {
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
    lines.push("Nenhum arquivo relevante encontrado dentro do limite informado.");
  } else {
    for (const entry of selected) {
      const description = descriptionFor(entry.note);
      lines.push(
        `- \`${entry.note.rel}\`: ${fallbackTitle(entry.note)}${
          description ? ` - ${description}` : ""
        }`,
      );
    }
  }

  lines.push("", "## Regras importantes para agentes", "");
  const rules = extractAgentRules(selected.map((entry) => entry.note));
  lines.push(...(rules.length > 0 ? rules.map((rule) => `- ${rule}`) : ["- Nenhuma regra explicita encontrada."]));
  lines.push("", "## Trechos relevantes", "");

  const remainingChars = Math.max(1200, maxTokens * 4 - lines.join("\n").length - 200);
  const perFileChars = Math.max(500, Math.floor(remainingChars / Math.max(1, selected.length)));
  for (const entry of selected) {
    lines.push(`### ${entry.note.rel}`, "");
    lines.push(relevantExcerpt(entry.note, tokens, perFileChars), "");
  }

  let content = lines.join("\n").trimEnd() + "\n";
  while (estimateTokens(content) > maxTokens && content.length > 500) {
    content = `${content.slice(0, Math.floor(content.length * 0.9)).trimEnd()}\n\n[Context pack truncated to respect maxTokens]\n`;
  }
  return content;
}

function extractAgentRules(notes: MarkdownNote[]): string[] {
  const rules: string[] = [];
  const re = /\b(rule|regra|must|never|always|sempre|nunca|não|nao|avoid|evite|obrigatorio|obrigatório)\b/i;
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

function relevantExcerpt(note: MarkdownNote, tokens: string[], maxChars: number): string {
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
    const block = [];
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

async function safeRenameNote(root: string, args: Record<string, unknown>) {
  const vault = await createVault(root);
  const from = await resolveMarkdownFile(vault, String(args.from ?? ""), {
    mustExist: true,
  });
  const to = await resolveMarkdownFile(vault, String(args.to ?? ""));
  const updateLinks = args.updateLinks !== false;
  const dryRun = args.dryRun === true;

  if (to.exists) {
    throw new Error(
      `Target file already exists. Use another path or remove the target first: ${to.rel}`,
    );
  }

  const notes = await loadMarkdownNotes(vault);
  const index = createNoteIndex(notes);
  const updates = updateLinks
    ? computeRenameUpdates(notes, index, from.rel, to.rel)
    : [];

  if (dryRun) {
    return {
      dryRun: true,
      filesToUpdate: updates.map(({ path: rel, replacements }) => ({
        path: rel,
        replacements,
      })),
      from: from.rel,
      to: to.rel,
      wouldRename: true,
    };
  }

  await fsp.mkdir(path.dirname(to.abs), { recursive: true });
  await assertRealPathInside(vault, path.dirname(to.abs));
  await fsp.rename(from.abs, to.abs);

  for (const update of updates) {
    const abs = update.path === from.rel ? to.abs : (index.byRel.get(update.path)?.abs ?? "");
    if (!abs) continue;
    await assertRealPathInside(vault, abs);
    await fsp.writeFile(abs, update.content, "utf-8");
  }

  return {
    dryRun: false,
    filesUpdated: updates.map(({ path: rel, replacements }) => ({
      path: rel === from.rel ? to.rel : rel,
      replacements,
    })),
    renamed: true,
  };
}

function computeRenameUpdates(
  notes: MarkdownNote[],
  index: NoteIndex,
  fromRel: string,
  toRel: string,
): Array<{ content: string; path: string; replacements: number }> {
  const updates = [];
  for (const note of notes) {
    let replacements = 0;
    const next = note.content
      .replace(/\[\[([^\]\n]+)\]\]/g, (raw, inner: string) => {
        const parsed = splitWikiTarget(inner);
        const link: LinkMatch = {
          alias: parsed.alias,
          line: 0,
          raw,
          target: parsed.pathPart,
          text: "",
          type: "wikilink",
        };
        if (!linkMatchesTarget(link, note.rel, fromRel, index)) return raw;
        replacements += 1;
        const anchorIndex = parsed.pathPart.indexOf("#");
        const anchor = anchorIndex >= 0 ? parsed.pathPart.slice(anchorIndex) : "";
        const sourceDir = path.posix.dirname(note.rel === fromRel ? toRel : note.rel);
        const target = wikilinkBetween(sourceDir, toRel) + anchor;
        return `[[${target}${parsed.alias ? `|${parsed.alias}` : ""}]]`;
      })
      .replace(/(!?)\[([^\]\n]*)\]\(([^)\n]+)\)/g, (raw, bang: string, text: string, hrefRaw: string) => {
        if (bang === "!") return raw;
        const href = stripLinkDecorations(hrefRaw);
        const link: LinkMatch = {
          href,
          line: 0,
          raw,
          target: href,
          text: "",
          type: "markdown",
        };
        if (!linkMatchesTarget(link, note.rel, fromRel, index)) return raw;
        replacements += 1;
        const sourceDir = path.posix.dirname(note.rel === fromRel ? toRel : note.rel);
        const visibleHref = markdownLinkBetween(sourceDir, toRel, href);
        return `[${text}](${visibleHref})`;
      });

    if (replacements > 0) {
      updates.push({ content: next, path: note.rel, replacements });
    }
  }
  return updates;
}

function markdownLinkBetween(sourceDir: string, destRel: string, originalHref: string): string {
  const cleanOriginal = stripLinkDecorations(originalHref);
  const originalPath = removeAnchorAndQuery(cleanOriginal);
  const originalExt = path.posix.extname(originalPath).toLowerCase();
  const dest = originalExt ? destRel : stripMarkdownExtension(destRel);
  let rel = path.posix.relative(sourceDir === "." ? "" : sourceDir, dest);
  if (!rel.startsWith(".") && originalHref.startsWith("./")) rel = `./${rel}`;
  return `${rel || path.posix.basename(dest)}${linkSuffix(cleanOriginal)}`;
}

function linkSuffix(target: string): string {
  const hashIndex = target.indexOf("#");
  const queryIndex = target.indexOf("?");
  const cut = [hashIndex, queryIndex]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  return cut === undefined ? "" : target.slice(cut);
}

async function lintMarkdownVault(root: string, args: Record<string, unknown>) {
  const vault = await createVault(root);
  const inputPath = String(args.path ?? "");
  const fix = args.fix === true;
  const dryRun = args.dryRun === true;
  const notes = await loadMarkdownNotes(vault, inputPath);
  const allNotes = inputPath ? await loadMarkdownNotes(vault) : notes;
  const issues: Issue[] = [];
  const index = createNoteIndex(allNotes);
  const fixes: Array<{ changes: string[]; lines?: number[]; path: string }> = [];
  let fixed = 0;

  addBrokenLinkIssues(notes, index, issues);
  addBrokenAnchorIssues(notes, index, issues);
  addMissingTitleIssues(notes, issues);
  addDuplicateTitleIssues(notes, issues);
  addLargeFileIssues(notes, issues);

  for (const note of notes) {
    const h1s = note.headings.filter((heading) => heading.level === 1);
    if (h1s.length > 1) {
      issues.push({
        file: note.rel,
        line: h1s[1].line,
        message: "File contains multiple H1 headings.",
        severity: "warning",
        type: "multiple_h1",
      });
    }

    let previousLevel = 0;
    for (const heading of note.headings) {
      if (previousLevel > 0 && heading.level > previousLevel + 1) {
        issues.push({
          file: note.rel,
          line: heading.line,
          message: `Heading jumps from H${previousLevel} to H${heading.level}.`,
          severity: "warning",
          type: "heading_level_skip",
        });
      }
      previousLevel = heading.level;
    }

    if (note.yamlError) {
      issues.push({
        file: note.rel,
        line: 1,
        message: note.yamlError,
        severity: "error",
        type: "frontmatter_invalid",
      });
    }

    const trailingLines = note.content.split(/\r?\n/);
    const trailingSpaceLines: number[] = [];
    for (let i = 0; i < trailingLines.length; i += 1) {
      if (/[ \t]+$/.test(trailingLines[i])) {
        trailingSpaceLines.push(i + 1);
        issues.push({
          file: note.rel,
          line: i + 1,
          message: "Line has trailing spaces.",
          severity: "warning",
          type: "trailing_spaces",
        });
      }
    }

    if (fix) {
      const fixedContent = note.content
        .split(/\r?\n/)
        .map((line) => line.replace(/[ \t]+$/g, ""))
        .join("\n")
        .replace(/\s*$/, "\n");
      if (fixedContent !== note.content) {
        const changes = [];
        if (trailingSpaceLines.length > 0) changes.push("remove_trailing_spaces");
        if (!note.content.endsWith("\n")) changes.push("ensure_final_newline");
        if (changes.length === 0) changes.push("normalize_final_newline");
        fixes.push({
          changes,
          ...(trailingSpaceLines.length > 0 ? { lines: trailingSpaceLines } : {}),
          path: note.rel,
        });

        if (!dryRun) {
          await assertRealPathInside(vault, note.abs);
          await fsp.writeFile(note.abs, fixedContent, "utf-8");
          fixed += 1;
        }
      }
    }
  }

  const sortedIssues = issues.sort(issueSort);
  return {
    ...(dryRun ? { dryRun: true, fixes } : {}),
    issues: sortedIssues,
    path: inputPath,
    summary: {
      filesScanned: notes.length,
      fixed,
      issuesFound: sortedIssues.length,
      ...(dryRun ? { wouldFix: fixes.length } : {}),
    },
  };
}

async function generateAgentBriefing(root: string, args: Record<string, unknown>) {
  const vault = await createVault(root);
  const task = String(args.task ?? "");
  const inputPath = typeof args.path === "string" ? args.path : "";
  const maxTokens = clampNumber(args.maxTokens, 6000, 500, 50000);
  const notes = await loadBriefingNotes(vault, inputPath);
  const index = createNoteIndex(notes);
  const graph = buildGraph(notes, index);
  const ranked = rankLoadedNotes(notes, task, graph, index);
  const recommended = prioritizeBriefingFiles(ranked, notes).slice(0, 8);
  const diagnostics = buildDiagnosticIssues(
    notes,
    new Set(["broken_links", "large_files", "missing_titles"]),
  );
  const content = buildBriefingContent(task, recommended, diagnostics, maxTokens);

  return {
    content,
    estimatedTokens: estimateTokens(content),
    recommendedFiles: recommended.map((entry) => entry.note.rel),
    task,
  };
}

async function loadBriefingNotes(
  vault: Vault,
  inputPath: string,
): Promise<MarkdownNote[]> {
  const refs = new Map<string, { abs: string; rel: string }>();
  for (const ref of await listMarkdownFileRefs(vault, inputPath)) {
    refs.set(ref.rel, ref);
  }
  for (const ref of await listMarkdownFileRefs(vault)) {
    if (path.posix.basename(ref.rel).toLowerCase() === "agents.md") {
      refs.set(ref.rel, ref);
    }
  }
  return Promise.all([...refs.values()].map((ref) => loadMarkdownNote(vault, ref)));
}

function prioritizeBriefingFiles(
  ranked: RankedNote[],
  notes: MarkdownNote[],
): RankedNote[] {
  const byRel = new Map(ranked.map((entry) => [entry.note.rel, entry]));
  const ordered: RankedNote[] = [];
  const push = (note: MarkdownNote, score: number, matchedBy: string[]) => {
    if (ordered.some((entry) => entry.note.rel === note.rel)) return;
    ordered.push(byRel.get(note.rel) ?? { matchedBy, note, score, snippet: snippetFor(note, []) });
  };

  for (const note of notes) {
    if (path.posix.basename(note.rel).toLowerCase() === "agents.md") {
      push(note, 100, ["agents"]);
    }
  }
  for (const note of notes) {
    if (path.posix.basename(note.rel).toLowerCase().startsWith("index.")) {
      push(note, 90, ["index"]);
    }
  }
  for (const entry of ranked) {
    if (ordered.some((candidate) => candidate.note.rel === entry.note.rel)) continue;
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
  const rules = extractAgentRules(recommended.map((entry) => entry.note));
  lines.push(...(rules.length > 0 ? rules.map((rule) => `- ${rule}`) : ["- Nenhuma regra explicita encontrada."]));

  lines.push("", "## Decisões técnicas relevantes", "");
  const decisions = extractDecisionLines(recommended.map((entry) => entry.note));
  lines.push(...(decisions.length > 0 ? decisions.map((decision) => `- ${decision}`) : ["- Consulte os arquivos recomendados antes de alterar comportamento existente."]));

  lines.push("", "## Possíveis riscos", "");
  const riskIssues = diagnostics.slice(0, 8);
  if (riskIssues.length === 0) {
    lines.push("- Nenhum risco estrutural encontrado nos checks rápidos.");
  } else {
    for (const issue of riskIssues) {
      lines.push(
        `- ${issue.file}${issue.line ? `:${issue.line}` : ""}: ${issue.message}`,
      );
    }
  }

  lines.push("", "## Próximos passos sugeridos", "");
  lines.push("- Leia os arquivos na ordem recomendada.");
  lines.push("- Confirme links internos e frontmatter antes de mover ou renomear notas.");
  lines.push("- Atualize `docs/index.md` quando criar notas novas.");

  lines.push("", "## Trechos relevantes", "");
  const tokens = tokenize(task);
  const perFileChars = Math.max(500, Math.floor((maxTokens * 4) / Math.max(1, recommended.length + 3)));
  for (const entry of recommended.slice(0, 6)) {
    lines.push(`### ${entry.note.rel}`, "");
    lines.push(relevantExcerpt(entry.note, tokens, perFileChars), "");
  }

  let content = lines.join("\n").trimEnd() + "\n";
  while (estimateTokens(content) > maxTokens && content.length > 500) {
    content = `${content.slice(0, Math.floor(content.length * 0.9)).trimEnd()}\n\n[Briefing truncated to respect maxTokens]\n`;
  }
  return content;
}

function extractDecisionLines(notes: MarkdownNote[]): string[] {
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
