import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVault } from "../../domain/vault/vault.interface.js";
import { PathResolver } from "../../domain/security/path-resolver.js";
import { TagService } from "../../domain/tags/tag.service.js";

export class ListTagsTool implements ITool {
  readonly definition = {
    name: "list_tags",
    description: "List tags found in frontmatter and inline markdown tags",
    inputSchema: {
      type: "object" as const,
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
  };

  constructor(
    private pathResolver: PathResolver,
    private vault: IVault,
    private tagService: TagService,
  ) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { includeFiles, path: subPath } = args as {
      includeFiles?: boolean;
      path?: string;
    };

    const root = this.pathResolver.resolveVaultPath(subPath ?? "");
    const tagMap = new Map<string, { count: number; files: Set<string> }>();

    const files = subPath
      ? await this.vault.listNotes(subPath || undefined)
      : await this.vault.listNotes();

    for (const file of files) {
      const content = await this.vault.readNoteContent(file);
      const tags = this.tagService.noteTags(content);

      for (const tag of tags) {
        const entry = tagMap.get(tag) ?? { count: 0, files: new Set<string>() };
        entry.count += 1;
        entry.files.add(file);
        tagMap.set(tag, entry);
      }
    }

    const tags = [...tagMap.entries()]
      .map(([tag, entry]) => ({
        count: entry.count,
        files: includeFiles
          ? [...entry.files].sort((a, b) => a.localeCompare(b))
          : undefined,
        tag,
      }))
      .sort((a, b) => a.tag.localeCompare(b.tag));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              tags,
              totalOccurrences: tags.reduce((sum, t) => sum + t.count, 0),
              totalTags: tags.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
