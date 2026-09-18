import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import {
  ASSETS_DIR,
  GENERATIONS_PATH,
  INDEX_PATH,
  LIBRARY_DIR,
  PACKAGE_ROOT,
} from "../paths.js";
import type { GenerationRecord, LibraryEntry } from "../types.js";
import { loadImageBytes } from "./images.js";

export { ASSETS_DIR, LIBRARY_DIR } from "../paths.js";

/**
 * Serializes every read-modify-write against the JSON stores.
 *
 * `generate_icon_set` fires N concurrent generations that each append a record;
 * without this, the last writer would silently drop the others' rows.
 */
let writeChain: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const result = writeChain.then(task, task);
  writeChain = result.catch(() => undefined);
  return result;
}

async function readJsonArray<T>(path: string): Promise<T[]> {
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf8");
  if (!raw.trim()) return [];
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

/** Write via temp file + rename so a crash mid-write cannot truncate the store. */
async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp-${randomUUID()}`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export async function ensureLibrary(): Promise<void> {
  await mkdir(ASSETS_DIR, { recursive: true });
  for (const path of [INDEX_PATH, GENERATIONS_PATH]) {
    if (!existsSync(path)) await writeJsonAtomic(path, []);
  }
}

async function append<T>(path: string, record: T): Promise<void> {
  await serialize(async () => {
    await ensureLibrary();
    const rows = await readJsonArray<T>(path);
    rows.push(record);
    await writeJsonAtomic(path, rows);
  });
}

export function appendGeneration(record: GenerationRecord): Promise<void> {
  return append(GENERATIONS_PATH, record);
}

export function readGenerations(): Promise<GenerationRecord[]> {
  return serialize(() => readJsonArray<GenerationRecord>(GENERATIONS_PATH));
}

export async function getGeneration(id: string): Promise<GenerationRecord | undefined> {
  const rows = await readGenerations();
  return rows.find((row) => row.id === id);
}

export function appendLibraryEntry(entry: LibraryEntry): Promise<void> {
  return append(INDEX_PATH, entry);
}

export function readLibrary(): Promise<LibraryEntry[]> {
  return serialize(() => readJsonArray<LibraryEntry>(INDEX_PATH));
}

/**
 * Download an image into library/assets/.
 * Returns the path relative to the package root, which is what index.json stores.
 */
export async function downloadAsset(source: string, id: string, contentType?: string): Promise<string> {
  const bytes = await loadImageBytes(source);
  const type = contentType ?? "image/png";
  const ext = type.includes("jpeg") || type.includes("jpg") ? "jpg" : type.includes("webp") ? "webp" : "png";
  return writeAsset(bytes, id, ext);
}

/** Write bytes we already hold (a locally produced cutout) into the asset folder. */
export async function writeAsset(bytes: Buffer, id: string, ext: string): Promise<string> {
  await ensureLibrary();
  const absolute = join(ASSETS_DIR, `${id}.${ext}`);
  await writeFile(absolute, bytes);
  return relative(PACKAGE_ROOT, absolute);
}

/** Absolute path for a package-relative asset path. */
export function absolutePath(relativePath: string): string {
  return join(PACKAGE_ROOT, relativePath);
}
