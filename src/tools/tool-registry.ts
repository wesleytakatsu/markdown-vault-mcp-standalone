import type { ITool } from "./tool.interface.js";
import type { ToolDefinition } from "../types/tools.js";
import { ToolNotFoundError, ToolExecutionError } from "../errors/vault-error.js";

export class ToolRegistry {
  private tools = new Map<string, ITool>();
  private aliases = new Map<string, string>();

  register(tool: ITool): void {
    this.tools.set(tool.definition.name, tool);
  }

  registerAlias(aliasName: string, definition: ToolDefinition, targetName: string): void {
    const canonicalName = definition.name;
    this.tools.set(aliasName, {
      definition: { ...definition, name: aliasName },
      execute: (args) => {
        const target = this.tools.get(targetName) ?? this.tools.get(canonicalName);
        if (!target) throw new ToolNotFoundError(targetName);
        return target.execute(args);
      },
    });
    this.aliases.set(aliasName, canonicalName);
  }

  getTool(name: string): ITool {
    const tool = this.tools.get(name);
    if (!tool) throw new ToolNotFoundError(name);
    return tool;
  }

  listDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: "text"; text: string }> }> {
    const tool = this.getTool(name);
    try {
      return await tool.execute(args);
    } catch (error) {
      throw new ToolExecutionError(name, error);
    }
  }
}
