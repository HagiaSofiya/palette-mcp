#!/usr/bin/env node
/**
 * palette-mcp - an MCP server for generating cohesive UI asset sets via fal.ai Flux.
 *
 * Transport is stdio, so stdout carries JSON-RPC and nothing else.
 * Every diagnostic must go to stderr or it will corrupt the protocol stream.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { ensureLibrary } from "./services/library.js";
import { resolveProvider } from "./services/providers/index.js";
import { registerGenerateIconSet } from "./tools/generateIconSet.js";
import { registerGenerateImage } from "./tools/generateImage.js";
import { registerGenerateVariations } from "./tools/generateVariations.js";
import { registerListLibrary } from "./tools/listLibrary.js";
import { registerRemoveBackground } from "./tools/removeBackground.js";
import { registerSaveToLibrary } from "./tools/saveToLibrary.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Load .env from the package root, not the working directory.
 * Claude Desktop spawns this server with an unrelated cwd, so the key lives
 * here rather than in claude_desktop_config.json.
 */
function loadEnv(): void {
  const envPath = join(PACKAGE_ROOT, ".env");
  if (!existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    console.error(`[palette-mcp] Could not read .env: ${(error as Error).message}`);
  }
}

async function main(): Promise<void> {
  loadEnv();
  await ensureLibrary();

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerGenerateImage(server);
  registerGenerateIconSet(server);
  registerGenerateVariations(server);
  registerRemoveBackground(server);
  registerSaveToLibrary(server);
  registerListLibrary(server);

  // A warning, not a fatal error: list_library and the tool schemas work without
  // credentials, and the generating tools explain the problem when they are called.
  let providerLabel = "unresolved";
  try {
    const provider = resolveProvider();
    providerLabel = provider.label;
    provider.assertConfigured();
  } catch (error) {
    console.error(`[palette-mcp] Warning: ${error instanceof Error ? error.message : String(error)}`);
  }

  await server.connect(new StdioServerTransport());
  console.error(
    `[palette-mcp] ${SERVER_NAME} v${SERVER_VERSION} ready on stdio - provider: ${providerLabel}`,
  );
}

main().catch((error: unknown) => {
  console.error(`[palette-mcp] Fatal: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
