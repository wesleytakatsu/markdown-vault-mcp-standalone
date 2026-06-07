import crypto from "node:crypto";
import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVault } from "../../domain/vault/vault.interface.js";
import { PathResolver } from "../../domain/security/path-resolver.js";
import { HeadingService } from "../../domain/markdown/heading.service.js";

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export class ReadSectionTool implements ITool {
  readonly definition = {
    name: "read_section",
    description: "Read a markdown heading section from one note",
    inputSchema: {
      type: "object" as const,
      properties: {
        heading: { type: "string" },
        includeHeading: {
          type: "boolean",
          description: "Include the heading line in the returned content; defaults to true",
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
      heading,
      includeHeading = true,
      path: notePath,
    } = args as {
      heading: string;
      includeHeading?: boolean;
      path: string;
    };
    const current = await this.vault.readNoteContent(notePath);
    const section = this.headingService.sectionContent(current, heading, includeHeading);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              content: section.section,
              heading,
              includeHeading,
              path: notePath,
              section: {
                endOffset: section.endOffset,
                line: section.target.line,
                startOffset: section.startOffset,
              },
              sha256: sha256(current),
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
