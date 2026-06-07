import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";
import type { IVaultAdvanced } from "./vault-advanced.interface.js";
import { taskItemsFromNotes } from "../../domain/note/task-extraction.js";

export class ExtractTasksTool implements ITool {
  readonly definition = {
    name: "markdown_vault_extract_tasks",
    description:
      "Extract open TODO/FIXME/task checkbox items from markdown notes",
    inputSchema: {
      type: "object" as const,
      properties: {
        groupBy: { type: "string", enum: ["file", "flat"] },
        includeDone: { type: "boolean" },
        path: {
          type: "string",
          description: "Directory or file to scan",
        },
      },
      required: ["path"],
    },
  };

  constructor(private vault: IVaultAdvanced) {}

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const inputPath = String(args.path ?? "");
    const includeDone = args.includeDone === true;
    const groupBy = args.groupBy === "flat" ? "flat" : "file";
    const notes = await this.vault.loadMarkdownNotes(inputPath);
    const tasks = taskItemsFromNotes(notes, includeDone);

    if (groupBy === "flat") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { count: tasks.length, path: inputPath, tasks },
              null,
              2,
            ),
          },
        ],
      };
    }

    const grouped = new Map<string, typeof tasks>();
    for (const task of tasks) {
      const entries = grouped.get(task.file) ?? [];
      entries.push(task);
      grouped.set(task.file, entries);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              count: tasks.length,
              groups: [...grouped.entries()].map(([file, fileTasks]) => ({
                file,
                tasks: fileTasks,
              })),
              path: inputPath,
              tasks,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
