import { JSON_MIME, SERVER_VERSION } from "../config/constants.js";
import type { IResourceHandler } from "./resource-handler.js";
import { PathResolver } from "../domain/security/path-resolver.js";
import { NoteService } from "../domain/note/note.service.js";

export class StatusResource implements IResourceHandler {
  readonly uriPattern = "markdown-vault://status";

  constructor(
    private pathResolver: PathResolver,
    private noteService: NoteService,
  ) {}

  async list(): Promise<Array<{
    description: string;
    mimeType: string;
    name: string;
    uri: string;
  }>> {
    return [
      {
        description: "Standalone server status and vault configuration",
        mimeType: JSON_MIME,
        name: "Markdown Vault MCP status",
        uri: "markdown-vault://status",
      },
    ];
  }

  async read(uri: string): Promise<{
    contents: Array<{
      mimeType: string;
      text: string;
      uri: string;
    }>;
  }> {
    const files: string[] = [];
    for await (const file of this.noteService.walkMarkdownFiles(this.pathResolver.root)) {
      files.push(this.pathResolver.relativePath(file));
    }

    return {
      contents: [
        {
          mimeType: JSON_MIME,
          text: JSON.stringify(
            {
              capabilities: ["tools", "resources"],
              mode: "filesystem",
              noteCount: files.length,
              server: "markdown-vault-mcp-standalone",
              transport: "stdio",
              vaultPath: this.pathResolver.root,
              version: SERVER_VERSION,
            },
            null,
            2,
          ),
          uri,
        },
      ],
    };
  }
}
