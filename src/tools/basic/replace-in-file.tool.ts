import crypto from "node:crypto";
import fsp from "node:fs/promises";
import { escapeRegExp } from "../../utils/string.utils.js";
import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVault } from "../../domain/vault/vault.interface.js";
import { PathResolver } from "../../domain/security/path-resolver.js";

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
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

export class ReplaceInFileTool implements ITool {
  readonly definition = {
    name: "replace_in_file",
    description: "Replace literal text or regex matches inside one note",
    inputSchema: {
      type: "object" as const,
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
  };

  constructor(
    private pathResolver: PathResolver,
    private vault: IVault,
  ) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
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

    let guarded: string | undefined;
    if (expectedSha256) {
      const current = await this.vault.readNoteContent(notePath);
      const currentSha256 = sha256(current);
      if (currentSha256 !== expectedSha256) {
        throw new Error(
          `SHA-256 mismatch: expected ${expectedSha256}, got ${currentSha256}`,
        );
      }
      guarded = current;
    }

    const beforeSha256 = guarded ? sha256(guarded) : undefined;
    const current = guarded ?? (await this.vault.readNoteContent(notePath));
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
      await this.vault.writeNote(notePath, result.content);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              changed: result.changed,
              ...(dryRun ? { dryRun: true } : {}),
              matches: result.matches,
              path: notePath,
              replacements: result.replacements,
              sha256After: sha256(result.content),
              sha256Before: beforeSha256 ?? sha256(current),
              sha256: sha256(result.content),
              wouldWrite: result.changed && dryRun === true,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
