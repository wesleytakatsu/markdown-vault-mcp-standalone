import crypto from "node:crypto";
import type { JsonValue } from "../../types/common.js";
import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVault } from "../../domain/vault/vault.interface.js";
import { PathResolver } from "../../domain/security/path-resolver.js";
import { FrontmatterService } from "../../domain/markdown/frontmatter.service.js";

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export class ManageFrontmatterTool implements ITool {
  readonly definition = {
    name: "manage_frontmatter",
    description: "Get, set, or delete simple YAML frontmatter keys",
    inputSchema: {
      type: "object" as const,
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
  };

  constructor(
    private pathResolver: PathResolver,
    private vault: IVault,
    private frontmatterService: FrontmatterService,
  ) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { action, expectedSha256, key, path: notePath, value } = args as {
      action: "get" | "set" | "delete";
      expectedSha256?: string;
      key?: string;
      path: string;
      value?: JsonValue;
    };

    let guarded: string | undefined;
    if (expectedSha256 && action !== "get") {
      const current = await this.vault.readNoteContent(notePath);
      const cs = sha256(current);
      if (cs !== expectedSha256) {
        throw new Error(`SHA-256 mismatch: expected ${expectedSha256}, got ${cs}`);
      }
      guarded = current;
    }

    const current = guarded ?? (await this.vault.readNoteContent(notePath));
    const parsed = this.frontmatterService.extract(current);

    if (action === "get") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              key ? { [key]: (parsed as Record<string, unknown>)[key] } : parsed,
              null,
              2,
            ),
          },
        ],
      };
    }

    if (!key) throw new Error("key is required for set/delete");

    const nextFrontmatter = { ...parsed } as Record<string, JsonValue>;
    if (action === "set") {
      nextFrontmatter[key] = value ?? null;
    } else {
      delete nextFrontmatter[key];
    }

    const next = this.frontmatterService.replaceFrontmatter(
      current,
      nextFrontmatter,
    );
    await this.vault.writeNote(notePath, next);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              frontmatter: nextFrontmatter,
              path: notePath,
              sha256: sha256(next),
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
