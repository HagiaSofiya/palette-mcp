import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Everything on disk resolves against the package root, never `process.cwd()`.
 * Claude Desktop spawns this server with an unrelated working directory.
 */
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const LIBRARY_DIR = join(PACKAGE_ROOT, "library");
export const ASSETS_DIR = join(LIBRARY_DIR, "assets");
export const INDEX_PATH = join(LIBRARY_DIR, "index.json");
export const GENERATIONS_PATH = join(LIBRARY_DIR, "generations.json");
