import { escapeRegExp } from "../../utils/string.utils.js";
import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVault } from "../../domain/vault/vault.interface.js";

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

export class SearchTool implements ITool {
  readonly definition = {
    name: "search",
    description: "Search markdown notes with literal or regex matching",
    inputSchema: {
      type: "object" as const,
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
  };

  constructor(
    private vault: IVault,
  ) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
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

    const matcher = buildSearchRegex({ caseSensitive, query, regex, wholeWord });
    const maxResults = Math.max(1, Math.min(limit, 500));
    const context = Math.max(0, Math.min(contextLines, 10));
    const results: Array<{
      context: string;
      line: number;
      path: string;
      text: string;
    }> = [];

    const files = subPath
      ? await this.vault.listNotes(subPath || undefined)
      : await this.vault.listNotes();

    for (const file of files) {
      const content = await this.vault.readNoteContent(file);
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        matcher.lastIndex = 0;
        if (!matcher.test(lines[i])) continue;

        results.push({
          context: lines
            .slice(Math.max(0, i - context), i + context + 1)
            .join("\n"),
          line: i + 1,
          path: file,
          text: lines[i],
        });

        if (results.length >= maxResults) break;
      }
      if (results.length >= maxResults) break;
    }

    if (format === "json") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { query, results, totalReturned: results.length },
              null,
              2,
            ),
          },
        ],
      };
    }

    const text =
      results
        .map((result) => `${result.path}:${result.line}:\n${result.context}\n---`)
        .join("\n") || "No matches found";
    return { content: [{ type: "text", text }] };
  }
}
