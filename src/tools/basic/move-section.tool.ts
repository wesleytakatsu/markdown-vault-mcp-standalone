import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { ensureTrailingNewline, trimToPreview } from "../../utils/string.utils.js";
import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVault } from "../../domain/vault/vault.interface.js";
import { PathResolver } from "../../domain/security/path-resolver.js";
import { HeadingService } from "../../domain/markdown/heading.service.js";

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function appendToDocument(content: string, patchContent: string): string {
  const prefix = content.trimEnd();
  const insertion = ensureTrailingNewline(patchContent.trimEnd());
  return prefix ? `${prefix}\n\n${insertion}` : insertion;
}

export class MoveSectionTool implements ITool {
  readonly definition = {
    name: "move_section",
    description: "Move a markdown heading section from one note to another note",
    inputSchema: {
      type: "object" as const,
      properties: {
        createTarget: {
          type: "boolean",
          description: "Create target note if it does not exist; defaults to true",
        },
        createTargetHeading: {
          type: "boolean",
          description: "Create target heading if append/prepend under heading is requested",
        },
        dryRun: { type: "boolean" },
        expectedSourceSha256: {
          type: "string",
          description: "Optional SHA-256 guard for the source file",
        },
        expectedTargetSha256: {
          type: "string",
          description: "Optional SHA-256 guard for the target file",
        },
        heading: { type: "string", description: "Source section heading" },
        includeHeading: {
          type: "boolean",
          description: "Move the heading line too; defaults to true",
        },
        operation: {
          type: "string",
          enum: ["append", "prepend"],
          description: "How to insert under targetHeading; defaults to append",
        },
        sourcePath: { type: "string" },
        targetHeading: {
          type: "string",
          description: "Optional heading in the target note to append/prepend under",
        },
        targetHeadingLevel: {
          type: "number",
          description: "Heading level when createTargetHeading is true; defaults to 2",
        },
        targetPath: { type: "string" },
      },
      required: ["sourcePath", "targetPath", "heading"],
    },
  };

  constructor(
    private pathResolver: PathResolver,
    private vault: IVault,
    private headingService: HeadingService,
  ) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const {
      createTarget = true,
      createTargetHeading = false,
      dryRun,
      expectedSourceSha256,
      expectedTargetSha256,
      heading,
      includeHeading = true,
      operation = "append",
      sourcePath,
      targetHeading,
      targetHeadingLevel = 2,
      targetPath,
    } = args as {
      createTarget?: boolean;
      createTargetHeading?: boolean;
      dryRun?: boolean;
      expectedSourceSha256?: string;
      expectedTargetSha256?: string;
      heading: string;
      includeHeading?: boolean;
      operation?: "append" | "prepend";
      sourcePath: string;
      targetHeading?: string;
      targetHeadingLevel?: number;
      targetPath: string;
    };

    const sourceAbs = this.pathResolver.resolveNotePath(sourcePath);
    const targetAbs = this.pathResolver.resolveNotePath(targetPath);
    if (sourceAbs === targetAbs) {
      throw new Error("move_section does not support moving within the same file");
    }

    let guardedSource: string | undefined;
    if (expectedSourceSha256) {
      const content = await this.vault.readNoteContent(sourcePath);
      const cs = sha256(content);
      if (cs !== expectedSourceSha256) {
        throw new Error(`SHA-256 mismatch: expected ${expectedSourceSha256}, got ${cs}`);
      }
      guardedSource = content;
    }

    const sourceCurrent = guardedSource ?? (await this.vault.readNoteContent(sourcePath));
    const sourceResult = this.headingService.deleteSection(sourceCurrent, heading, includeHeading);

    const targetExists = await this.vault.noteExists(targetPath);
    if (!targetExists && !createTarget) {
      throw new Error("Target file does not exist. Pass createTarget: true to create it.");
    }

    let targetCurrent = "";
    if (targetExists) {
      if (expectedTargetSha256) {
        const content = await this.vault.readNoteContent(targetPath);
        const cs = sha256(content);
        if (cs !== expectedTargetSha256) {
          throw new Error(`SHA-256 mismatch: expected ${expectedTargetSha256}, got ${cs}`);
        }
        targetCurrent = content;
      } else {
        targetCurrent = await this.vault.readNoteContent(targetPath);
      }
    }

    let targetNext: string;
    if (targetHeading) {
      if (operation === "prepend") {
        targetNext = this.headingService.prependSection(
          targetCurrent,
          targetHeading,
          sourceResult.removed,
        );
      } else {
        targetNext = this.headingService.appendSection(
          targetCurrent,
          targetHeading,
          sourceResult.removed,
          createTargetHeading,
          targetHeadingLevel,
        );
      }
    } else {
      targetNext = appendToDocument(targetCurrent, sourceResult.removed);
    }

    if (!dryRun) {
      await this.vault.writeNote(sourcePath, sourceResult.next);
      await fsp.mkdir(path.dirname(targetAbs), { recursive: true });
      await this.vault.writeNote(targetPath, targetNext);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ...(dryRun ? { dryRun: true } : {}),
              heading,
              includeHeading,
              movedChars: sourceResult.removed.length,
              movedPreview: trimToPreview(sourceResult.removed),
              source: {
                path: sourcePath,
                sha256After: sha256(sourceResult.next),
                sha256Before: sha256(sourceCurrent),
              },
              target: {
                created: !targetExists,
                path: targetPath,
                sha256After: sha256(targetNext),
                sha256Before: targetExists ? sha256(targetCurrent) : null,
              },
              wouldWrite: dryRun === true,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
