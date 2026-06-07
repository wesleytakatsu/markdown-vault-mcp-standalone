import crypto from "node:crypto";
import { trimToPreview } from "../../utils/string.utils.js";
import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVault } from "../../domain/vault/vault.interface.js";
import { PathResolver } from "../../domain/security/path-resolver.js";
import { HeadingService } from "../../domain/markdown/heading.service.js";

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export class DeleteSectionTool implements ITool {
  readonly definition = {
    name: "delete_section",
    description: "Delete a markdown heading section from one note",
    inputSchema: {
      type: "object" as const,
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
  };

  constructor(
    private pathResolver: PathResolver,
    private vault: IVault,
    private headingService: HeadingService,
  ) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
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

    let guarded: string | undefined;
    if (expectedSha256) {
      const content = await this.vault.readNoteContent(notePath);
      const currentSha256 = sha256(content);
      if (currentSha256 !== expectedSha256) {
        throw new Error(
          `SHA-256 mismatch: expected ${expectedSha256}, got ${currentSha256}`,
        );
      }
      guarded = content;
    }

    const current = guarded ?? (await this.vault.readNoteContent(notePath));
    const result = this.headingService.deleteSection(current, heading, includeHeading);

    if (!dryRun && result.next !== current) {
      await this.vault.writeNote(notePath, result.next);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
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
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
