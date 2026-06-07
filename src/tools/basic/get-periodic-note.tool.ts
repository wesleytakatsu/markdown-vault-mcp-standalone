import type { ITool } from "../tool.interface.js";
import type { ToolResult } from "../../types/tools.js";

export class GetPeriodicNoteTool implements ITool {
  readonly definition = {
    name: "get_periodic_note",
    description: "Get periodic note filename for today (daily, weekly, etc.)",
    inputSchema: {
      type: "object" as const,
      properties: {
        period: {
          type: "string",
          enum: ["daily", "weekly", "monthly", "quarterly", "yearly"],
          description: "Period type",
        },
      },
      required: ["period"],
    },
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const { period } = args as { period: string };
    const now = new Date();
    let filename: string;

    switch (period) {
      case "daily":
        filename = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.md`;
        break;
      case "weekly": {
        const dayOfWeek = now.getDay();
        const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
        const monday = new Date(now);
        monday.setDate(diff);
        filename = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}.md`;
        break;
      }
      case "monthly":
        filename = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}.md`;
        break;
      case "quarterly": {
        const q = Math.floor(now.getMonth() / 3) + 1;
        filename = `${now.getFullYear()}-Q${q}.md`;
        break;
      }
      case "yearly":
        filename = `${now.getFullYear()}.md`;
        break;
      default:
        throw new Error(`Unknown period: ${period}`);
    }
    return { content: [{ type: "text", text: filename }] };
  }
}
