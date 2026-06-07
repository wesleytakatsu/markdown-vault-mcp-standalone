import crypto from "node:crypto";
import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVault } from "../../domain/vault/vault.interface.js";
import { PathResolver } from "../../domain/security/path-resolver.js";
import { HeadingService } from "../../domain/markdown/heading.service.js";

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export class PatchNoteTool implements ITool {
  readonly definition = {
    name: "patch_note",
    description: "Append, prepend, or replace content under a markdown heading",
    inputSchema: {
      type: "object" as const,
      properties: {
        content: { type: "string" },
        createHeading: {
          type: "boolean",
          description: "Create the heading if it does not exist",
        },
        expectedSha256: {
          type: "string",
          description: "Optional SHA-256 guard for the current file content",
        },
        heading: { type: "string" },
        headingLevel: {
          type: "number",
          description: "Heading level when createHeading is true; defaults to 2",
        },
        operation: {
          type: "string",
          enum: ["append", "prepend", "replace"],
        },
        path: { type: "string", description: "Markdown file path relative to vault root" },
      },
      required: ["path", "heading", "operation", "content"],
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
      operation,
      path: notePath,
    } = args as {
      content: string;
      createHeading?: boolean;
      expectedSha256?: string;
      heading: string;
      headingLevel?: number;
      operation: "append" | "prepend" | "replace";
      path: string;
    };

    let guarded: string | undefined;
    if (expectedSha256) {
      const current = await this.vault.readNoteContent(notePath);
      const cs = sha256(current);
      if (cs !== expectedSha256) {
        throw new Error(`SHA-256 mismatch: expected ${expectedSha256}, got ${cs}`);
      }
      guarded = current;
    }

    const current = guarded ?? (await this.vault.readNoteContent(notePath));

    let next: string;
    switch (operation) {
      case "replace":
        next = this.headingService.replaceSection(
          current,
          heading,
          content,
          createHeading,
          headingLevel,
        );
        break;
      case "prepend":
        next = this.headingService.prependSection(current, heading, content);
        break;
      case "append":
      default:
        next = this.headingService.appendSection(
          current,
          heading,
          content,
          createHeading,
          headingLevel,
        );
        break;
    }

    await this.vault.writeNote(notePath, next);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              operation,
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
