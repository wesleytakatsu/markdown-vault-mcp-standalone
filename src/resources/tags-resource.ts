import fsp from "node:fs/promises";
import { JSON_MIME } from "../config/constants.js";
import type { IResourceHandler } from "./resource-handler.js";
import { PathResolver } from "../domain/security/path-resolver.js";
import { NoteService } from "../domain/note/note.service.js";
import { TagService } from "../domain/tags/tag.service.js";

export class TagsResource implements IResourceHandler {
  readonly uriPattern = "markdown-vault://tags";

  constructor(
    private pathResolver: PathResolver,
    private noteService: NoteService,
    private tagService: TagService,
  ) {}

  async list(): Promise<Array<{
    description: string;
    mimeType: string;
    name: string;
    uri: string;
  }>> {
    return [
      {
        description: "All vault tags with usage counts",
        mimeType: JSON_MIME,
        name: "Vault tags",
        uri: "markdown-vault://tags",
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
    const tags = await this.listAllTags();
    return {
      contents: [
        {
          mimeType: JSON_MIME,
          text: JSON.stringify(tags, null, 2),
          uri,
        },
      ],
    };
  }

  private async listAllTags() {
    const root = this.pathResolver.root;
    const tagMap = new Map<string, { count: number; files: Set<string> }>();

    for await (const file of this.noteService.walkMarkdownFiles(root)) {
      const rel = this.pathResolver.relativePath(file);
      const content = await fsp.readFile(file, "utf-8");
      const tags = this.tagService.noteTags(content);

      for (const tag of tags) {
        const entry = tagMap.get(tag) ?? { count: 0, files: new Set<string>() };
        entry.count += 1;
        entry.files.add(rel);
        tagMap.set(tag, entry);
      }
    }

    const tags = [...tagMap.entries()]
      .map(([tag, entry]) => ({
        count: entry.count,
        files: [...entry.files].sort((a, b) => a.localeCompare(b)),
        tag,
      }))
      .sort((a, b) => a.tag.localeCompare(b.tag));

    return {
      tags,
      totalOccurrences: tags.reduce((sum, tag) => sum + tag.count, 0),
      totalTags: tags.length,
    };
  }
}
