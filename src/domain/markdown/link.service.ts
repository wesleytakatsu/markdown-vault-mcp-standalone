import path from "node:path";
import type {
  MarkdownNote,
  NoteIndex,
  LinkGraph,
  LinkMatch,
} from "../../types/markdown.js";
import { MARKDOWN_EXTENSIONS } from "../../config/constants.js";
import { normalizeRelCandidate, stripMarkdownExtension } from "../../utils/string.utils.js";
import type { MarkdownParser } from "./markdown.parser.js";

export function splitWikiTarget(value: string): { alias?: string; pathPart: string } {
  const [target, alias] = value.split("|", 2);
  return { alias: alias?.trim(), pathPart: target.trim() };
}

export function stripLinkDecorations(target: string): string {
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

export function isExternalLink(target: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target);
}

export function removeAnchorAndQuery(target: string): string {
  const hashIndex = target.indexOf("#");
  const queryIndex = target.indexOf("?");
  const cut = [hashIndex, queryIndex]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  return cut === undefined ? target : target.slice(0, cut);
}

export function linkSuffix(target: string): string {
  const hashIndex = target.indexOf("#");
  const queryIndex = target.indexOf("?");
  const cut = [hashIndex, queryIndex]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  return cut === undefined ? "" : target.slice(cut);
}

export function linkAnchor(link: LinkMatch): string | undefined {
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

function targetNoExtFromLink(link: LinkMatch): string | undefined {
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
  return cleanTarget;
}

export function linkLookupKeys(link: LinkMatch, sourceRel: string): string[] {
  const cleanTarget = targetNoExtFromLink(link);
  if (!cleanTarget) return [];

  const targetNoExt = stripMarkdownExtension(
    cleanTarget.replace(/\\/g, "/"),
    MARKDOWN_EXTENSIONS,
  );
  const sourceDir = path.posix.dirname(sourceRel);
  const candidates = [
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

export function linkRawNoExt(link: LinkMatch): string | undefined {
  const cleanTarget = targetNoExtFromLink(link);
  if (!cleanTarget) return undefined;
  const normalized = normalizeRelCandidate(
    stripMarkdownExtension(cleanTarget, MARKDOWN_EXTENSIONS),
  );
  return normalized?.toLowerCase();
}

export function wikilinkBetween(sourceDir: string, destRel: string): string {
  const destNoExt = stripMarkdownExtension(destRel, MARKDOWN_EXTENSIONS);
  const rel = path.posix.relative(sourceDir === "." ? "" : sourceDir, destNoExt);
  return rel.replace(/^\.\//, "");
}

export function markdownLinkBetween(
  sourceDir: string,
  destRel: string,
  originalHref: string,
): string {
  const cleanOriginal = stripLinkDecorations(originalHref);
  const originalPath = removeAnchorAndQuery(cleanOriginal);
  const originalExt = path.posix.extname(originalPath).toLowerCase();
  const dest = originalExt ? destRel : stripMarkdownExtension(destRel, MARKDOWN_EXTENSIONS);
  let rel = path.posix.relative(sourceDir === "." ? "" : sourceDir, dest);
  if (!rel.startsWith(".") && originalHref.startsWith("./")) rel = `./${rel}`;
  return `${rel || path.posix.basename(dest)}${linkSuffix(cleanOriginal)}`;
}

export function createNoteIndex(notes: MarkdownNote[]): NoteIndex {
  const byRel = new Map<string, MarkdownNote>();
  const byRelNoExt = new Map<string, string>();
  const byBasenameNoExt = new Map<string, string[]>();
  const relNoExtByRel = new Map<string, string>();

  for (const note of notes) {
    byRel.set(note.rel, note);
    const noExt = stripMarkdownExtension(note.rel, MARKDOWN_EXTENSIONS).toLowerCase();
    relNoExtByRel.set(note.rel, noExt);
    byRelNoExt.set(noExt, note.rel);
    const basename = path.posix.basename(noExt);
    const entries = byBasenameNoExt.get(basename) ?? [];
    entries.push(note.rel);
    byBasenameNoExt.set(basename, entries);
  }

  return { byBasenameNoExt, byRel, byRelNoExt, relNoExtByRel };
}

export function resolveLink(link: LinkMatch, sourceRel: string, index: NoteIndex): string | undefined {
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

export function linkExists(link: LinkMatch, sourceRel: string, index: NoteIndex): boolean {
  if (resolveLink(link, sourceRel, index)) return true;
  const raw = linkRawNoExt(link);
  if (!raw) return true;
  const basename = path.posix.basename(raw);
  if (!raw.includes("/") && (index.byBasenameNoExt.get(basename)?.length ?? 0) > 0) {
    return true;
  }
  return [...index.byRelNoExt.keys()].some((key) => key === raw || key.endsWith(`/${raw}`));
}

export function linkMatchesTarget(
  link: LinkMatch,
  sourceRel: string,
  targetRel: string,
  index: NoteIndex,
): boolean {
  const resolved = resolveLink(link, sourceRel, index);
  if (resolved) return resolved === targetRel;

  const raw = linkRawNoExt(link);
  if (!raw) return false;
  const targetNoExt = stripMarkdownExtension(targetRel, MARKDOWN_EXTENSIONS).toLowerCase();
  const targetBase = path.posix.basename(targetNoExt);
  return raw === targetNoExt || raw === targetBase || targetNoExt.endsWith(`/${raw}`);
}

export function buildGraph(notes: MarkdownNote[], index: NoteIndex): LinkGraph {
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

/** Thin DI-friendly facade over the pure link-resolution functions above. */
export class LinkService {
  constructor(private parser: MarkdownParser) {}

  createNoteIndex(notes: MarkdownNote[]): NoteIndex {
    return createNoteIndex(notes);
  }

  buildGraph(notes: MarkdownNote[], index: NoteIndex): LinkGraph {
    return buildGraph(notes, index);
  }

  resolveLink(link: LinkMatch, sourceRel: string, index: NoteIndex): string | undefined {
    return resolveLink(link, sourceRel, index);
  }

  linkExists(link: LinkMatch, sourceRel: string, index: NoteIndex): boolean {
    return linkExists(link, sourceRel, index);
  }

  linkMatchesTarget(
    link: LinkMatch,
    sourceRel: string,
    targetRel: string,
    index: NoteIndex,
  ): boolean {
    return linkMatchesTarget(link, sourceRel, targetRel, index);
  }
}
