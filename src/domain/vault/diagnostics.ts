import path from "node:path";
import type { Issue, LinkGraph, MarkdownNote, NoteIndex } from "../../types/markdown.js";
import { hasHeadingAnchor } from "../markdown/heading-anchor.utils.js";
import {
  buildGraph,
  createNoteIndex,
  linkAnchor,
  linkExists,
  resolveLink,
} from "../markdown/link.service.js";
import { normalizeText } from "../../utils/string.utils.js";

export function isOrphanException(rel: string): boolean {
  const base = path.posix.basename(rel).toLowerCase();
  return base === "index.md" || base === "readme.md" || base === "agents.md";
}

export function issueSort(a: Issue, b: Issue): number {
  return (
    (a.file ?? "").localeCompare(b.file ?? "") ||
    (a.line ?? 0) - (b.line ?? 0) ||
    a.type.localeCompare(b.type)
  );
}

export function addBrokenLinkIssues(notes: MarkdownNote[], index: NoteIndex, issues: Issue[]): void {
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

export function addBrokenAnchorIssues(notes: MarkdownNote[], index: NoteIndex, issues: Issue[]): void {
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

export function addMissingTitleIssues(notes: MarkdownNote[], issues: Issue[]): void {
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

export function addDuplicateTitleIssues(notes: MarkdownNote[], issues: Issue[]): void {
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

export function addEmptyFileIssues(notes: MarkdownNote[], issues: Issue[]): void {
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

export function addOrphanIssues(notes: MarkdownNote[], graph: LinkGraph, issues: Issue[]): void {
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

export function addMissingFrontmatterIssues(notes: MarkdownNote[], issues: Issue[]): void {
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

export function addLargeFileIssues(notes: MarkdownNote[], issues: Issue[]): void {
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

export function buildDiagnosticIssues(
  notes: MarkdownNote[],
  checks: Set<string>,
  allNotes: MarkdownNote[] = notes,
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

export function addLintStructuralIssues(notes: MarkdownNote[], issues: Issue[]): void {
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

    const lines = note.content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (!/[ \t]+$/.test(lines[i])) continue;
      issues.push({
        file: note.rel,
        line: i + 1,
        message: "Line has trailing spaces.",
        severity: "warning",
        type: "trailing_spaces",
      });
    }
  }
}
