export type ToolDefinition = {
  description: string;
  inputSchema: Record<string, unknown>;
  name: string;
};

export type ToolResult = {
  content: Array<{
    type: "text";
    text: string;
  }>;
};
