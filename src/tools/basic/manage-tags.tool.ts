import crypto from "node:crypto";
import { normalizeTags } from "../../utils/string.utils.js";
import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVault } from "../../domain/vault/vault.interface.js";
import { PathResolver } from "../../domain/security/path-resolver.js";
import { TagService } from "../../domain/tags/tag.service.js";
import { FrontmatterService } from "../../domain/markdown/frontmatter.service.js";

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export class ManageTagsTool implements ITool {
  readonly definition = {
    name: "manage_tags",
    description: "List, add, or remove tags in frontmatter and/or inline note text",
    inputSchema: {
      type: "object" as const,
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
  };

  constructor(
    private pathResolver: PathResolver,
    private vault: IVault,
    private tagService: TagService,
    private frontmatterService: FrontmatterService,
  ) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
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

    let guarded: string | undefined;
    if (expectedSha256 && action !== "list") {
      const content = await this.vault.readNoteContent(notePath);
      const cs = sha256(content);
      if (cs !== expectedSha256) {
        throw new Error(`SHA-256 mismatch: expected ${expectedSha256}, got ${cs}`);
      }
      guarded = content;
    }

    const current = guarded ?? (await this.vault.readNoteContent(notePath));
    const frontmatter = this.frontmatterService.extract(current);

    if (action === "list") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                frontmatter: this.tagService.frontmatterTags(frontmatter),
                inline: this.tagService.inlineTags(
                  current.replace(/^---[\s\S]*?---\r?\n?/, ""),
                ),
                tags: this.tagService.noteTags(current),
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    const normalized = normalizeTags(tags as string[]);
    if (normalized.length === 0) {
      throw new Error("tags is required for add/remove");
    }

    const nextFrontmatter = { ...frontmatter };
    let nextBody = current.replace(/^---[\s\S]*?---\r?\n?/, "");

    if (location === "frontmatter" || location === "both") {
      const currentTags = new Set(
        this.tagService.frontmatterTags(nextFrontmatter),
      );
      if (action === "add") {
        for (const tag of normalized) currentTags.add(tag);
      } else {
        for (const tag of normalized) currentTags.delete(tag);
      }

      const sorted = [...currentTags].sort((a, b) => a.localeCompare(b));
      if (sorted.length > 0) {
        (nextFrontmatter as Record<string, unknown>).tags = sorted;
      } else {
        delete (nextFrontmatter as Record<string, unknown>).tags;
      }
    }

    if (location === "inline" || location === "both") {
      if (action === "add") {
        const existing = new Set(this.tagService.inlineTags(nextBody));
        const missing = normalized.filter((tag) => !existing.has(tag));
        if (missing.length > 0) {
          nextBody = `${nextBody.trimEnd()}\n\n${missing
            .map((tag) => `#${tag}`)
            .join(" ")}\n`;
        }
      } else {
        nextBody = this.tagService.removeInlineTagsFromBody(nextBody, normalized);
      }
    }

    const serialized = this.frontmatterService.serialize(nextFrontmatter);
    const finalContent = `${serialized}${nextBody}`;

    await this.vault.writeNote(notePath, finalContent);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              path: notePath,
              sha256: sha256(finalContent),
              tags: this.tagService.noteTags(finalContent),
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
