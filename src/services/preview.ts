import sharp from "sharp";

import { PREVIEW_PX, PREVIEW_QUALITY } from "../constants.js";
import { loadImageBytes } from "./images.js";

export interface Preview {
  data: string;
  mimeType: string;
}

/**
 * Build a small inline preview of a generated image.
 *
 * Downscaling is mandatory, not cosmetic: a raw 1024x1024 PNG is ~1.5MB, which
 * base64-encodes to ~2MB of context per image. At 256px this lands around 15-40KB.
 *
 * Images with an alpha channel stay PNG so that a background-removal result is
 * actually inspectable; flattening a cutout onto white would make it look
 * identical to the original.
 */
export async function buildPreview(reference: string): Promise<Preview> {
  const source = sharp(await loadImageBytes(reference));
  const { hasAlpha } = await source.metadata();

  const resized = source.resize(PREVIEW_PX, PREVIEW_PX, { fit: "inside", withoutEnlargement: true });

  if (hasAlpha) {
    const data = await resized.png({ compressionLevel: 9, palette: true }).toBuffer();
    return { data: data.toString("base64"), mimeType: "image/png" };
  }

  const data = await resized.jpeg({ quality: PREVIEW_QUALITY }).toBuffer();
  return { data: data.toString("base64"), mimeType: "image/jpeg" };
}
