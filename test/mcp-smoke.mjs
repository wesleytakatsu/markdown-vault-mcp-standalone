import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const vault = await mkdtemp(path.join(tmpdir(), "markdown-vault-mcp-vault-"));
let nextId = 1;
const pending = new Map();
let clientTransport;

async function request(method, params) {
  const id = nextId++;
  const response = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}`));
    }, 5000);

    pending.set(id, {
      reject,
      resolve: (message) => {
        clearTimeout(timeout);
        resolve(message);
      },
    });
  });

  await clientTransport.send({ jsonrpc: "2.0", id, method, params });
  const message = await response;
  assert.equal(message.id, id);
  return message;
}

function parseToolText(result) {
  assert.equal(result.content[0].type, "text");
  return result.content[0].text;
}

function parseToolJson(result) {
  return JSON.parse(parseToolText(result));
}

async function ok(method, params) {
  const response = await request(method, params);
  assert.equal(response.error, undefined, response.error?.message);
  return response.result;
}

async function fails(method, params, pattern) {
  const response = await request(method, params);
  assert.ok(response.error, `Expected ${method} to fail`);
  assert.match(response.error.message, pattern);
}

async function tool(name, args = {}) {
  return ok("tools/call", { name, arguments: args });
}

async function toolFails(name, args, pattern) {
  return fails("tools/call", { name, arguments: args }, pattern);
}

try {
  await mkdir(path.join(vault, "notes"), { recursive: true });
  await mkdir(path.join(vault, "docs", "backend"), { recursive: true });
  await mkdir(path.join(vault, "docs", "setup"), { recursive: true });
  await mkdir(path.join(vault, "docs", "old"), { recursive: true });

  await writeFile(
    path.join(vault, "AGENTS.md"),
    [
      "# Agent Rules",
      "- Always read [[docs/index]] before documentation work.",
      "- Never move notes without checking [[docs/backend/auth#JWT]].",
      "- Regra: preserve existing tools and resources.",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    path.join(vault, "README.md"),
    [
      "# Project README",
      "",
      "Project overview for agents. Start at [[docs/index]].",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    path.join(vault, "docs", "index.md"),
    [
      "---",
      "description: Documentation map",
      "tags: [docs]",
      "---",
      "# Documentation Index",
      "",
      "- [[backend/auth]]",
      "- [[backend/auth#JWT]]",
      "- [Auth JWT](backend/auth.md#jwt)",
      "- [JWT Auth Slug](backend/auth.md#jwt-auth)",
      "- [Docker](./setup/docker.md#compose)",
      "- [Broken](setup/env.md)",
      "- [Broken Anchor](backend/auth.md#missing-heading)",
      "",
      "TODO: update missing env link",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    path.join(vault, "docs", "backend", "auth.md"),
    [
      "---",
      "status: active",
      "type: guide",
      "tags:",
      "  - backend",
      "  - auth",
      "description: Como funciona autenticacao JWT no backend",
      "---",
      "# Autenticação",
      "",
      "Auth guide for JWT backend. See [[routes#rotas-protegidas|Rotas]] and [Docker](../setup/docker.md#compose).",
      "",
      "## JWT",
      "",
      "Token rules for protected APIs.",
      "",
      "## JWT / Auth",
      "",
      "TODO: revisar expiração do JWT",
      "- [ ] Ajustar refresh token",
      "",
      "# Extra Title",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    path.join(vault, "docs", "backend", "routes.md"),
    [
      "---",
      "tags: [backend]",
      "description: Rotas HTTP protegidas por autenticacao",
      "---",
      "# Autenticação",
      "",
      "Routes documentation links back to [[auth#JWT|Auth]].  ",
      "",
      "### Rotas Protegidas",
      "",
      "FIXME: document guards",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    path.join(vault, "docs", "setup", "docker.md"),
    [
      "---",
      "description: Como subir o ambiente local com Docker Compose",
      "tags: [setup, docker]",
      "---",
      "# Docker",
      "",
      "Use Docker Compose to run the project locally. Link [Auth](../backend/auth.md).",
      "",
      "## Compose",
      "",
      "- [x] Completed setup note",
      "- [ ] Ajustar Docker Compose",
      "@todo document env vars",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    path.join(vault, "docs", "old", "deprecated.md"),
    "old\n",
    "utf-8",
  );
  await writeFile(
    path.join(vault, "docs", "large.md"),
    [
      "# Large Reference",
      "",
      ...Array.from({ length: 805 }, (_, index) => `Line ${index + 1} for context limits.`),
      "",
    ].join("\n"),
    "utf-8",
  );
  await symlink("/etc/passwd", path.join(vault, "docs", "escape.md"));

  await writeFile(
    path.join(vault, "notes", "example.md"),
    [
      "---",
      "tags:",
      "  - alpha",
      "status: draft",
      "---",
      "# Title",
      "Intro #inline",
      "",
      "## Tasks",
      "- TODO old token",
      "",
      "[[Other Note]]",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    path.join(vault, "notes", "other.md"),
    "# Other Note\nbeta\n",
    "utf-8",
  );

  process.env.MARKDOWN_VAULT_PATH = vault;
  const { server } = await import("../dist/index.js");
  const [client, serverTransport] = InMemoryTransport.createLinkedPair();
  clientTransport = client;
  clientTransport.onmessage = (message) => {
    if (!("id" in message)) return;
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    handler.resolve(message);
  };
  clientTransport.onerror = (error) => {
    for (const [, handler] of pending) handler.reject(error);
    pending.clear();
  };
  await server.connect(serverTransport);
  await clientTransport.start();

  const tools = await ok("tools/list");
  const toolNames = tools.tools.map((entry) => entry.name);
  for (const expected of [
    "append_file",
    "list_files",
    "list_tags",
    "manage_frontmatter",
    "manage_tags",
    "patch_note",
    "read_file",
    "replace_in_file",
    "search",
    "write_file",
    "markdown_vault_build_context_pack",
    "markdown_vault_diagnose_docs",
    "markdown_vault_extract_tasks",
    "markdown_vault_find_relevant_notes",
    "markdown_vault_generate_agent_briefing",
    "markdown_vault_generate_index",
    "markdown_vault_get_backlinks",
    "markdown_vault_impact_analysis",
    "markdown_vault_lint",
    "markdown_vault_safe_rename_note",
  ]) {
    assert.ok(toolNames.includes(expected), `Missing tool ${expected}`);
  }

  const files = parseToolText(await tool("list_files"));
  assert.match(files, /notes\/example\.md/);

  const metadata = parseToolJson(
    await tool("read_file", {
      format: "metadata",
      path: "notes/example.md",
    }),
  );
  assert.equal(metadata.frontmatter.status, "draft");
  assert.deepEqual(metadata.tags, ["alpha", "inline"]);
  assert.equal(metadata.headings[1].text, "Tasks");

  const search = parseToolJson(
    await tool("search", {
      format: "json",
      path: "notes",
      query: "TODO",
    }),
  );
  assert.equal(search.totalReturned, 1);
  assert.equal(search.results[0].path, "notes/example.md");

  await tool("write_file", {
    content: "# New\n",
    path: "notes/new.md",
  });
  await toolFails(
    "write_file",
    {
      content: "# Unsafe\n",
      path: "notes/new.md",
    },
    /overwrite: true/,
  );

  const newMetadata = parseToolJson(
    await tool("read_file", {
      format: "metadata",
      path: "notes/new.md",
    }),
  );
  await toolFails(
    "write_file",
    {
      content: "# Wrong hash\n",
      expectedSha256: "bad",
      overwrite: true,
      path: "notes/new.md",
    },
    /SHA-256 mismatch/,
  );
  await tool("write_file", {
    content: "# New\nupdated\n",
    expectedSha256: newMetadata.metadata.sha256,
    overwrite: true,
    path: "notes/new.md",
  });

  await tool("append_file", {
    content: "- DONE appended",
    heading: "Tasks",
    path: "notes/example.md",
  });
  await tool("patch_note", {
    content: "- TOP",
    heading: "Tasks",
    operation: "prepend",
    path: "notes/example.md",
  });
  await tool("patch_note", {
    content: "created section",
    createHeading: true,
    heading: "Created",
    headingLevel: 3,
    operation: "replace",
    path: "notes/example.md",
  });

  const replace = parseToolJson(
    await tool("replace_in_file", {
      path: "notes/example.md",
      replace: "new token",
      search: "old token",
    }),
  );
  assert.equal(replace.replacements, 1);

  await tool("manage_frontmatter", {
    action: "set",
    key: "status",
    path: "notes/example.md",
    value: "ready",
  });
  const status = parseToolJson(
    await tool("manage_frontmatter", {
      action: "get",
      key: "status",
      path: "notes/example.md",
    }),
  );
  assert.equal(status.status, "ready");
  await tool("manage_frontmatter", {
    action: "delete",
    key: "status",
    path: "notes/example.md",
  });

  await tool("manage_tags", {
    action: "add",
    location: "frontmatter",
    path: "notes/example.md",
    tags: ["agent"],
  });
  await tool("manage_tags", {
    action: "remove",
    location: "inline",
    path: "notes/example.md",
    tags: ["inline"],
  });
  const noteTags = parseToolJson(
    await tool("manage_tags", {
      action: "list",
      path: "notes/example.md",
    }),
  );
  assert.deepEqual(noteTags.frontmatter, ["agent", "alpha"]);
  assert.deepEqual(noteTags.inline, []);

  const vaultTags = parseToolJson(
    await tool("list_tags", {
      includeFiles: true,
    }),
  );
  assert.ok(vaultTags.tags.some((entry) => entry.tag === "agent"));
  assert.ok(vaultTags.tags.some((entry) => entry.tag === "alpha"));

  const templates = await ok("resources/templates/list");
  assert.equal(templates.resourceTemplates[0].uriTemplate, "markdown-vault://vault/{path}");

  const resources = await ok("resources/list");
  const resourceUris = resources.resources.map((entry) => entry.uri);
  assert.ok(resourceUris.includes("markdown-vault://status"));
  assert.ok(resourceUris.includes("markdown-vault://tags"));
  assert.ok(resourceUris.includes("markdown-vault://vault/notes/example.md"));

  const tagResource = await ok("resources/read", { uri: "markdown-vault://tags" });
  const tagResourceJson = JSON.parse(tagResource.contents[0].text);
  assert.ok(tagResourceJson.tags.some((entry) => entry.tag === "agent"));

  const noteResource = await ok("resources/read", {
    uri: "markdown-vault://vault/notes/example.md",
  });
  const noteResourceJson = JSON.parse(noteResource.contents[0].text);
  assert.equal(noteResourceJson.metadata.path, "notes/example.md");
  assert.ok(noteResourceJson.content.includes("new token"));

  const statusResource = await ok("resources/read", { uri: "markdown-vault://status" });
  const statusJson = JSON.parse(statusResource.contents[0].text);
  assert.equal(statusJson.mode, "filesystem");
  assert.equal(statusJson.transport, "stdio");

  await toolFails(
    "read_file",
    {
      path: "../outside.md",
    },
    /Path traversal denied/,
  );
  await toolFails(
    "markdown_vault_get_backlinks",
    {
      path: "../outside.md",
    },
    /Path traversal denied/,
  );
  await toolFails(
    "read_file",
    {
      path: "docs/escape.md",
    },
    /outside vault/,
  );

  const backlinks = parseToolJson(
    await tool("markdown_vault_get_backlinks", {
      includeContext: true,
      path: "docs/backend/auth",
    }),
  );
  assert.equal(backlinks.target, "docs/backend/auth.md");
  assert.ok(backlinks.count >= 4);
  assert.ok(backlinks.backlinks.some((entry) => entry.path === "docs/index.md"));
  assert.ok(backlinks.backlinks.some((entry) => entry.path === "AGENTS.md"));

  const impact = parseToolJson(
    await tool("markdown_vault_impact_analysis", {
      path: "docs/backend/auth.md",
    }),
  );
  assert.equal(impact.exists, true);
  assert.equal(impact.title, "Autenticação");
  assert.equal(impact.frontmatter.status, "active");
  assert.ok(impact.tags.includes("backend"));
  assert.ok(impact.outgoingLinks.includes("docs/backend/routes.md"));
  assert.ok(impact.backlinks.includes("docs/index.md"));
  assert.ok(impact.risks.length > 0);

  const generatedIndexDryRun = parseToolJson(
    await tool("markdown_vault_generate_index", {
      dryRun: true,
      includeDescriptions: true,
      mode: "hierarchical",
      overwrite: false,
      path: "docs",
      target: "docs/generated-index.md",
    }),
  );
  assert.equal(generatedIndexDryRun.dryRun, true);
  assert.equal(generatedIndexDryRun.wouldCreate, true);
  assert.equal(generatedIndexDryRun.wouldUpdate, false);
  assert.match(
    generatedIndexDryRun.contentPreview,
    /\[\[backend\/auth\]\] — Autenticação — Como funciona autenticacao JWT no backend/,
  );
  await assert.rejects(
    readFile(path.join(vault, "docs", "generated-index.md"), "utf-8"),
  );

  const generatedIndex = parseToolJson(
    await tool("markdown_vault_generate_index", {
      includeDescriptions: true,
      mode: "hierarchical",
      overwrite: false,
      path: "docs",
      target: "docs/generated-index.md",
    }),
  );
  assert.equal(generatedIndex.created, true);
  assert.equal(generatedIndex.updated, false);
  assert.ok(generatedIndex.filesIndexed >= 6);
  const generatedIndexContent = await readFile(
    path.join(vault, "docs", "generated-index.md"),
    "utf-8",
  );
  assert.match(generatedIndexContent, /\[\[backend\/auth\]\]/);
  assert.match(
    generatedIndexContent,
    /\[\[backend\/auth\]\] — Autenticação — Como funciona autenticacao JWT no backend/,
  );
  await toolFails(
    "markdown_vault_generate_index",
    {
      path: "docs",
      target: "docs/generated-index.md",
    },
    /overwrite: true/,
  );

  const diagnostics = parseToolJson(
    await tool("markdown_vault_diagnose_docs", {
      checks: [
        "broken_links",
        "broken_anchors",
        "missing_titles",
        "duplicate_titles",
        "empty_files",
        "orphan_notes",
        "missing_frontmatter",
        "large_files",
      ],
      path: "docs",
    }),
  );
  assert.ok(diagnostics.summary.filesScanned >= 7);
  assert.ok(diagnostics.issues.some((issue) => issue.type === "broken_links"));
  assert.ok(diagnostics.issues.some((issue) => issue.type === "broken_anchors"));
  assert.ok(diagnostics.issues.some((issue) => issue.type === "duplicate_titles"));
  assert.ok(diagnostics.issues.some((issue) => issue.type === "missing_titles"));
  assert.ok(diagnostics.issues.some((issue) => issue.type === "missing_frontmatter"));
  assert.ok(diagnostics.issues.some((issue) => issue.type === "large_files"));

  const tasks = parseToolJson(
    await tool("markdown_vault_extract_tasks", {
      groupBy: "file",
      includeDone: false,
      path: "docs",
    }),
  );
  assert.ok(tasks.count >= 5);
  assert.ok(tasks.groups.some((group) => group.file === "docs/setup/docker.md"));
  assert.ok(tasks.tasks.some((task) => task.text.includes("Ajustar Docker Compose")));
  assert.ok(!tasks.tasks.some((task) => task.text.includes("Completed setup note")));

  const contextPack = parseToolJson(
    await tool("markdown_vault_build_context_pack", {
      exclude: ["docs/old/**"],
      include: ["docs/**/*.md", "AGENTS.md"],
      maxTokens: 12000,
      mode: "agent",
      path: "docs",
      topic: "como rodar o projeto com Docker",
    }),
  );
  assert.ok(contextPack.estimatedTokens <= 12000);
  assert.ok(contextPack.filesUsed.includes("AGENTS.md"));
  assert.ok(contextPack.filesUsed.includes("docs/setup/docker.md"));
  assert.match(contextPack.content, /# Context Pack:/);

  const genericContextPack = parseToolJson(
    await tool("markdown_vault_build_context_pack", {
      maxTokens: 4000,
      mode: "agent",
      path: "docs",
      topic: "entenda o projeto",
    }),
  );
  assert.ok(genericContextPack.estimatedTokens <= 4000);
  assert.ok(genericContextPack.filesUsed.includes("AGENTS.md"));
  assert.ok(genericContextPack.filesUsed.includes("README.md"));
  assert.ok(genericContextPack.filesUsed.includes("docs/index.md"));

  const relevant = parseToolJson(
    await tool("markdown_vault_find_relevant_notes", {
      limit: 10,
      path: "docs",
      query: "autenticação JWT no backend",
      strategy: "hybrid",
    }),
  );
  assert.ok(
    relevant.results.some((result) => result.path === "docs/backend/auth.md"),
  );
  const authResult = relevant.results.find(
    (result) => result.path === "docs/backend/auth.md",
  );
  assert.ok(authResult.matchedBy.includes("title"));

  const renameDryRun = parseToolJson(
    await tool("markdown_vault_safe_rename_note", {
      dryRun: true,
      from: "docs/backend/auth.md",
      to: "docs/backend/autenticacao.md",
      updateLinks: true,
    }),
  );
  assert.equal(renameDryRun.dryRun, true);
  assert.equal(renameDryRun.wouldRename, true);
  assert.ok(
    renameDryRun.filesToUpdate.some((entry) => entry.path === "docs/index.md"),
  );
  await readFile(path.join(vault, "docs", "backend", "auth.md"), "utf-8");
  await assert.rejects(
    readFile(path.join(vault, "docs", "backend", "autenticacao.md"), "utf-8"),
  );

  const lintDryRun = parseToolJson(
    await tool("markdown_vault_lint", {
      dryRun: true,
      fix: true,
      path: "docs",
    }),
  );
  assert.equal(lintDryRun.dryRun, true);
  assert.equal(lintDryRun.summary.fixed, 0);
  assert.ok(lintDryRun.summary.wouldFix >= 1);
  assert.ok(
    lintDryRun.fixes.some((entry) => entry.path === "docs/backend/routes.md"),
  );
  const routesAfterLintDryRun = await readFile(
    path.join(vault, "docs", "backend", "routes.md"),
    "utf-8",
  );
  assert.match(routesAfterLintDryRun, /Auth\]\]\.  \n/);

  const lint = parseToolJson(
    await tool("markdown_vault_lint", {
      fix: false,
      path: "docs",
    }),
  );
  assert.ok(lint.summary.filesScanned >= 6);
  assert.ok(lint.issues.some((issue) => issue.type === "multiple_h1"));
  assert.ok(lint.issues.some((issue) => issue.type === "heading_level_skip"));
  assert.ok(lint.issues.some((issue) => issue.type === "trailing_spaces"));
  assert.ok(lint.issues.some((issue) => issue.type === "broken_anchors"));

  const briefing = parseToolJson(
    await tool("markdown_vault_generate_agent_briefing", {
      maxTokens: 6000,
      path: "docs",
      task: "implementar autenticação JWT no backend",
    }),
  );
  assert.ok(briefing.estimatedTokens <= 6000);
  assert.ok(briefing.recommendedFiles.includes("AGENTS.md"));
  assert.ok(briefing.recommendedFiles.includes("docs/index.md"));
  assert.match(briefing.content, /# Briefing para agente/);

  const finalContent = await readFile(
    path.join(vault, "notes", "example.md"),
    "utf-8",
  );
  assert.match(finalContent, /- TOP/);
  assert.match(finalContent, /- DONE appended/);
  assert.match(finalContent, /### Created/);
  assert.match(finalContent, /new token/);

  console.log("MCP smoke test passed");
} finally {
  if (clientTransport) await clientTransport.close();
  await rm(vault, { force: true, recursive: true });
}
