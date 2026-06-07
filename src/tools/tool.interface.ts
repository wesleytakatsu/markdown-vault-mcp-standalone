import type { ToolDefinition, ToolResult } from "../types/tools.js";

export interface ITool {
  readonly definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}
