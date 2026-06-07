import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVault } from "../../domain/vault/vault.interface.js";
import { PathResolver } from "../../domain/security/path-resolver.js";
import { HeadingService } from "../../domain/markdown/heading.service.js";
import { ensureTrailingNewline } from "../../utils/string.utils.js";

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export class AppendFileTool implements ITool {
  readonly definition = {
    name: "append_file",
    description: "Append content to a note or to a specific heading section",
    inputSchema: {
      type: "object" as const,
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
  };

  constructor(
    private pathResolver: PathResolver,
    private vault: IVault,
    private headingService: HeadingService,
  ) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
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
    const abs = this.pathResolver.resolveNotePath(notePath);
    const exists = await this.vault.noteExists(notePath);

    if (exists && expectedSha256) {
      const current = await this.vault.readNoteContent(notePath);
      const currentSha256 = sha256(current);
      if (currentSha256 !== expectedSha256) {
        throw new Error(
          `SHA-256 mismatch: expected ${expectedSha256}, got ${currentSha256}`,
        );
      }
    }

    await fsp.mkdir(path.dirname(abs), { recursive: true });
    const current = exists ? await this.vault.readNoteContent(notePath) : "";

    let next: string;
    if (heading) {
      next = this.headingService.appendSection(
        current,
        heading,
        content,
        createHeading,
        headingLevel,
      );
    } else {
      next = current
        ? `${current.trimEnd()}\n${ensureTrailingNewline(content.trimEnd())}`
        : ensureTrailingNewline(content.trimEnd());
    }

    await this.vault.writeNote(notePath, next);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              path: notePath,
              sha256: sha256(next),
              size: Buffer.byteLength(next, "utf-8"),
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
