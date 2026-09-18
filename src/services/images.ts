import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PACKAGE_ROOT } from "../paths.js";

/**
 * Read image bytes from wherever they live.
 *
 * Generated images arrive as remote urls, but cutouts are produced locally and
 * only ever exist on disk, so every consumer needs to handle both.
 */
export async function loadImageBytes(source: string): Promise<Buffer> {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(
        `Could not fetch ${source} - HTTP ${response.status} ${response.statusText}. ` +
          "Provider urls expire; regenerate the image or use one saved in the library.",
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  const path = source.startsWith("file://")
    ? fileURLToPath(source)
    : isAbsolute(source)
      ? source
      : resolve(PACKAGE_ROOT, source);

  return readFile(path);
}
