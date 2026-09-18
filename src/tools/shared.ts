import { randomBytes } from "node:crypto";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { pathToFileURL } from "node:url";

import sharp from "sharp";

import { RATE_LIMIT_RETRIES, SET_CONCURRENCY } from "../constants.js";
import { absolutePath, writeAsset } from "../services/library.js";
import { buildPreview } from "../services/preview.js";
import { ProviderError, type GeneratedImage } from "../services/providers/index.js";

/** Short, readable ids - the model has to copy these between tool calls. */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}

/** Flux seeds are uint32. */
export function randomSeed(): number {
  return randomBytes(4).readUInt32BE(0);
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Tool errors return `isError: true` with text only.
 * The SDK skips output-schema validation on error results, by design.
 */
export function toolError(message: string): CallToolResult {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

type ContentBlock = CallToolResult["content"][number];

export function toolResult(
  summary: string,
  structuredContent: Record<string, unknown>,
  extraContent: ContentBlock[] = [],
): CallToolResult {
  return {
    content: [{ type: "text", text: summary }, ...extraContent],
    structuredContent,
  };
}

/**
 * Build inline previews, tolerating failures.
 *
 * A preview is a convenience; if fetching or resizing one fails, the generation
 * itself still succeeded and the urls are still useful. Never fail a tool over it.
 */
export async function previewBlocks(
  include: boolean,
  urls: string[],
): Promise<ContentBlock[]> {
  if (!include || urls.length === 0) return [];

  const settled = await Promise.allSettled(urls.map((url) => buildPreview(url)));
  return settled.flatMap((outcome): ContentBlock[] =>
    outcome.status === "fulfilled"
      ? [{ type: "image", data: outcome.value.data, mimeType: outcome.value.mimeType }]
      : [{ type: "text", text: `(preview unavailable: ${describeError(outcome.reason)})` }],
  );
}

/**
 * Retry a provider call when the failure is transient.
 *
 * Together's free tier allows roughly 10 image requests a minute, so a 429 on a
 * larger set is expected rather than exceptional. Backoff is 2s, 4s, 8s.
 */
export async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof ProviderError && error.retryable;
      if (!retryable || attempt === RATE_LIMIT_RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
    }
  }

  throw lastError;
}

/**
 * Map over items with bounded concurrency, settling every one.
 *
 * A set must not fan out all at once into a rate-limited free tier, and one
 * concept failing must not discard the concepts that succeeded.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  limit: number = SET_CONCURRENCY,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: string }>> {
  const results = new Array<{ ok: true; value: R } | { ok: false; error: string }>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { ok: true, value: await worker(items[index]!, index) };
      } catch (error) {
        results[index] = { ok: false, error: describeError(error) };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

export interface MaterializedImage {
  /** Always set: a provider url, or a file:// url for a locally written image. */
  url: string;
  /** Package-relative path, set only when the image was written to disk. */
  path?: string;
  width?: number;
  height?: number;
  warnings: string[];
}

/**
 * Normalise what a provider returned into something uniform.
 *
 * Together and fal.ai host the result and hand back a url; Cloudflare returns
 * the bytes inline. Inline bytes are written into the asset folder immediately,
 * because otherwise they would only exist in memory and be lost on the next call.
 */
export async function materialize(image: GeneratedImage, id: string): Promise<MaterializedImage> {
  const warnings = image.warnings ?? [];

  if (image.bytes) {
    const ext = image.contentType?.includes("png") ? "png" : "jpg";
    const path = await writeAsset(image.bytes, id, ext);
    const { width, height } = await sharp(image.bytes).metadata();
    return { url: pathToFileURL(absolutePath(path)).href, path, width, height, warnings };
  }

  if (!image.url) {
    throw new Error("The provider returned neither a url nor image bytes.");
  }

  return { url: image.url, width: image.width, height: image.height, warnings };
}
