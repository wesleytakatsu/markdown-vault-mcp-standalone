#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMCP } from "./server.js";

const MODULE_PATH = fileURLToPath(import.meta.url);

const VAULT_PATH =
  process.env.MARKDOWN_VAULT_PATH ??
  (() => {
    const fromScript = path.resolve(MODULE_PATH, "../../../docs");
    if (fs.existsSync(fromScript)) return fromScript;
    const fromCwd = path.resolve(process.cwd(), "docs");
    if (fs.existsSync(fromCwd)) return fromCwd;
    return "";
  })();

const resolvedVault = VAULT_PATH
  ? (fs.existsSync(VAULT_PATH) ? VAULT_PATH : "")
  : "";

export const { server } = createMCP(resolvedVault);

async function main() {
  if (!VAULT_PATH) {
    console.error("MARKDOWN_VAULT_PATH not set and no docs/ found.");
    console.error(
      "Set env var or place this server so that docs/ exists relative to it.",
    );
    process.exit(1);
  }
  if (!fs.existsSync(VAULT_PATH)) {
    console.error(`Vault path does not exist: ${VAULT_PATH}`);
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Markdown Vault MCP running - vault: ${VAULT_PATH}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === MODULE_PATH) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

export { createMCP } from "./server.js";
