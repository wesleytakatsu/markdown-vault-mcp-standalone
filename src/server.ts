import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { SERVER_VERSION } from "./config/constants.js";
import { PathResolver } from "./domain/security/path-resolver.js";
import { MarkdownParser } from "./domain/markdown/markdown.parser.js";
import { FrontmatterService } from "./domain/markdown/frontmatter.service.js";
import { HeadingService } from "./domain/markdown/heading.service.js";
import { LinkService } from "./domain/markdown/link.service.js";
import { MarkdownFormatter } from "./domain/markdown/markdown.formatter.js";
import { TagService } from "./domain/tags/tag.service.js";
import { NoteService } from "./domain/note/note.service.js";
import { Vault } from "./domain/vault/vault.js";
import { VaultAdvanced } from "./domain/vault/vault-advanced.js";
import { ToolRegistry } from "./tools/tool-registry.js";

import { ListFilesTool } from "./tools/basic/list-files.tool.js";
import { ReadFileTool } from "./tools/basic/read-file.tool.js";
import { SearchTool } from "./tools/basic/search.tool.js";
import { AppendFileTool } from "./tools/basic/append-file.tool.js";
import { WriteFileTool } from "./tools/basic/write-file.tool.js";
import { ReplaceInFileTool } from "./tools/basic/replace-in-file.tool.js";
import { ReadSectionTool } from "./tools/basic/read-section.tool.js";
import { DeleteSectionTool } from "./tools/basic/delete-section.tool.js";
import { MoveSectionTool } from "./tools/basic/move-section.tool.js";
import { PatchNoteTool } from "./tools/basic/patch-note.tool.js";
import { ManageFrontmatterTool } from "./tools/basic/manage-frontmatter.tool.js";
import { ListTagsTool } from "./tools/basic/list-tags.tool.js";
import { ManageTagsTool } from "./tools/basic/manage-tags.tool.js";
import { GetPeriodicNoteTool } from "./tools/basic/get-periodic-note.tool.js";

import { BacklinksTool } from "./tools/advanced/backlinks.tool.js";
import { ImpactAnalysisTool } from "./tools/advanced/impact-analysis.tool.js";
import { GenerateIndexTool } from "./tools/advanced/generate-index.tool.js";
import { DiagnoseDocsTool } from "./tools/advanced/diagnose-docs.tool.js";
import { ExtractTasksTool } from "./tools/advanced/extract-tasks.tool.js";
import { BuildContextPackTool } from "./tools/advanced/build-context-pack.tool.js";
import { FindRelevantNotesTool } from "./tools/advanced/find-relevant-notes.tool.js";
import { SafeRenameNoteTool } from "./tools/advanced/safe-rename-note.tool.js";
import { LintTool } from "./tools/advanced/lint.tool.js";
import { AuditTool } from "./tools/advanced/audit.tool.js";
import { GenerateAgentBriefingTool } from "./tools/advanced/generate-agent-briefing.tool.js";

import { VaultResource } from "./resources/vault-resource.js";
import { TagsResource } from "./resources/tags-resource.js";
import { StatusResource } from "./resources/status-resource.js";
import type { IResourceHandler } from "./resources/resource-handler.js";

const MODULE_PATH = fileURLToPath(import.meta.url);

function detectVaultPath(): string {
  const fromScript = path.resolve(MODULE_PATH, "../../../docs");
  if (fs.existsSync(fromScript)) return fromScript;
  const fromCwd = path.resolve(process.cwd(), "docs");
  if (fs.existsSync(fromCwd)) return fromCwd;
  return "";
}

export function createServices(vaultPath: string) {
  const resolved = path.resolve(vaultPath);
  const realRoot = fs.existsSync(resolved) ? fs.realpathSync(resolved) : "";

  const pathResolver = new PathResolver(resolved, realRoot);
  const parser = new MarkdownParser();
  const frontmatterService = new FrontmatterService(parser);
  const headingService = new HeadingService(parser);
  const linkService = new LinkService(parser);
  const formatter = new MarkdownFormatter();
  const tagService = new TagService(parser);
  const noteService = new NoteService(
    pathResolver,
    parser,
    headingService,
    frontmatterService,
    linkService,
    tagService,
    formatter,
  );

  const vault = new Vault(pathResolver, noteService, parser, formatter);
  const vaultAdvanced = new VaultAdvanced(
    pathResolver,
    parser,
    linkService,
    formatter,
    tagService,
  );

  return {
    pathResolver,
    parser,
    frontmatterService,
    headingService,
    linkService,
    formatter,
    tagService,
    noteService,
    vault,
    vaultAdvanced,
  };
}

export function createToolRegistry(
  vault: Vault,
  vaultAdvanced: VaultAdvanced,
  pathResolver: PathResolver,
  headingService: HeadingService,
  frontmatterService: FrontmatterService,
  tagService: TagService,
): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register(new ListFilesTool(pathResolver, vault));
  registry.register(new ReadFileTool(pathResolver, vault));
  registry.register(new SearchTool(vault));
  registry.register(new AppendFileTool(pathResolver, vault, headingService));
  registry.register(new WriteFileTool(pathResolver, vault));
  registry.register(new ReplaceInFileTool(pathResolver, vault));
  const readSectionTool = new ReadSectionTool(pathResolver, vault, headingService);
  const deleteSectionTool = new DeleteSectionTool(pathResolver, vault, headingService);
  const moveSectionTool = new MoveSectionTool(pathResolver, vault, headingService);

  registry.register(readSectionTool);
  registry.register(deleteSectionTool);
  registry.register(moveSectionTool);

  registry.registerAlias(
    "markdown_vault_read_section",
    readSectionTool.definition,
    "read_section",
  );
  registry.registerAlias(
    "markdown_vault_delete_section",
    deleteSectionTool.definition,
    "delete_section",
  );
  registry.registerAlias(
    "markdown_vault_move_section",
    moveSectionTool.definition,
    "move_section",
  );
  registry.register(new PatchNoteTool(pathResolver, vault, headingService));
  registry.register(new ManageFrontmatterTool(pathResolver, vault, frontmatterService));
  registry.register(new ListTagsTool(pathResolver, vault, tagService));
  registry.register(new ManageTagsTool(pathResolver, vault, tagService, frontmatterService));
  registry.register(new GetPeriodicNoteTool());

  registry.register(new BacklinksTool(vaultAdvanced));
  registry.register(new ImpactAnalysisTool(vaultAdvanced));
  registry.register(new GenerateIndexTool(vaultAdvanced));
  registry.register(new DiagnoseDocsTool(vaultAdvanced));
  registry.register(new ExtractTasksTool(vaultAdvanced));
  registry.register(new BuildContextPackTool(vaultAdvanced));
  registry.register(new FindRelevantNotesTool(vaultAdvanced));
  registry.register(new SafeRenameNoteTool(vaultAdvanced));
  registry.register(new LintTool(vaultAdvanced));
  registry.register(new AuditTool(vaultAdvanced));
  registry.register(new GenerateAgentBriefingTool(vaultAdvanced));

  return registry;
}

export function createResourceHandlers(
  vault: Vault,
  pathResolver: PathResolver,
  tagService: TagService,
  noteService: NoteService,
): IResourceHandler[] {
  return [
    new StatusResource(pathResolver, noteService),
    new TagsResource(pathResolver, noteService, tagService),
    new VaultResource(vault, pathResolver, noteService),
  ];
}

export function createMCP(vaultPath: string) {
  const services = createServices(vaultPath);
  const toolRegistry = createToolRegistry(
    services.vault,
    services.vaultAdvanced,
    services.pathResolver,
    services.headingService,
    services.frontmatterService,
    services.tagService,
  );
  const resourceHandlers = createResourceHandlers(
    services.vault,
    services.pathResolver,
    services.tagService,
    services.noteService,
  );

  const server = new Server(
    {
      name: "markdown-vault-mcp-standalone",
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolRegistry.listDefinitions(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    return toolRegistry.execute(name, args);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources: Array<{
      description: string;
      mimeType: string;
      name: string;
      size?: number;
      uri: string;
    }> = [];

    for (const handler of resourceHandlers) {
      const items = await handler.list();
      resources.push(...items);
    }

    return { resources };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [
      {
        description: "Read a markdown note by vault-relative path",
        mimeType: "application/json",
        name: "Vault note",
        uriTemplate: "markdown-vault://vault/{path}",
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    for (const handler of resourceHandlers) {
      if (uri === handler.uriPattern) {
        return handler.read(uri);
      }
      const basePattern = handler.uriPattern.replace(/\{[^}]+\}.*$/, "");
      if (basePattern && uri.startsWith(basePattern)) {
        return handler.read(uri);
      }
    }

    throw new Error(`Unsupported resource URI: ${uri}`);
  });

  return { server, services, toolRegistry, resourceHandlers };
}
