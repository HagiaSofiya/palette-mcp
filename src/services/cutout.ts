import sharp from "sharp";

/**
 * Remove a flat background by keying the connected border region to alpha.
 *
 * Every built-in style preset asks for a "plain background", so the images this
 * server generates are flat artwork with hard edges on a uniform field. For that
 * input a connected-region key is exact and instant, and avoids shipping ~380MB
 * of ONNX runtime and model weights to do matting an icon does not need.
 *
 * Three details make it hold up on real generations:
 *  - the background colour is *sampled* from the border rather than assumed to
 *    be pure white, because diffusion models happily return cream or pale grey
 *  - the fill is 4-connected from the border, so background-coloured pixels
 *    *inside* the artwork (a highlight, the hole in a letter O) stay opaque
 *  - boundary pixels get fractional alpha, so edges do not alias
 *
 * Known limitation, surfaced to the caller through `removedRatio`: this is a
 * keyer, not a matting model. It does not work on photographs or busy backgrounds.
 */

export interface CutoutResult {
  png: Buffer;
  width: number;
  height: number;
  /** Fraction of pixels turned transparent, 0-1. A low value means a non-flat background. */
  removedRatio: number;
  /** The background colour that was sampled and keyed out. */
  backgroundColor: { r: number; g: number; b: number };
}

/** Chebyshev distance in RGB. Generous enough for JPEG ringing on a flat field. */
export const DEFAULT_TOLERANCE = 38;

export async function flatBackgroundCutout(
  source: Buffer,
  tolerance: number = DEFAULT_TOLERANCE,
): Promise<CutoutResult> {
  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const pixels = new Uint8Array(data);
  const total = width * height;

  const background = sampleBorderColor(pixels, width, height);

  /** Chebyshev distance from the sampled background colour. */
  const distance = (index: number): number =>
    Math.max(
      Math.abs(pixels[index * 4]! - background.r),
      Math.abs(pixels[index * 4 + 1]! - background.g),
      Math.abs(pixels[index * 4 + 2]! - background.b),
    );

  // Flood fill inward from every border pixel that matches the background.
  const isBackground = new Uint8Array(total);
  const stack: number[] = [];

  const seed = (index: number): void => {
    if (!isBackground[index] && distance(index) <= tolerance) {
      isBackground[index] = 1;
      stack.push(index);
    }
  };

  for (let x = 0; x < width; x += 1) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    seed(y * width);
    seed(y * width + width - 1);
  }

  while (stack.length > 0) {
    const index = stack.pop()!;
    const x = index % width;
    const y = (index - x) / width;

    if (x > 0) seed(index - 1);
    if (x < width - 1) seed(index + 1);
    if (y > 0) seed(index - width);
    if (y < height - 1) seed(index + width);
  }

  // Apply alpha, feathering pixels that touch the background so edges stay smooth.
  let removed = 0;
  for (let index = 0; index < total; index += 1) {
    if (isBackground[index]) {
      pixels[index * 4 + 3] = 0;
      removed += 1;
      continue;
    }

    const x = index % width;
    const y = (index - x) / width;
    const touchesBackground =
      (x > 0 && isBackground[index - 1] === 1) ||
      (x < width - 1 && isBackground[index + 1] === 1) ||
      (y > 0 && isBackground[index - width] === 1) ||
      (y < height - 1 && isBackground[index + width] === 1);

    if (!touchesBackground) continue;

    // Edge pixel close to the background colour: fade in proportion to distance.
    const value = distance(index);
    if (value < tolerance * 2) {
      pixels[index * 4 + 3] = Math.round(Math.min(1, value / (tolerance * 2)) * 255);
    }
  }

  const png = await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return { png, width, height, removedRatio: removed / total, backgroundColor: background };
}

/**
 * Median colour of the border ring.
 *
 * Median rather than mean so that artwork bleeding to the edge cannot drag the
 * sampled colour away from the true background.
 */
function sampleBorderColor(
  pixels: Uint8Array,
  width: number,
  height: number,
): { r: number; g: number; b: number } {
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];

  const take = (index: number): void => {
    reds.push(pixels[index * 4]!);
    greens.push(pixels[index * 4 + 1]!);
    blues.push(pixels[index * 4 + 2]!);
  };

  for (let x = 0; x < width; x += 1) {
    take(x);
    take((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    take(y * width);
    take(y * width + width - 1);
  }

  const median = (values: number[]): number => {
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)]!;
  };

  return { r: median(reds), g: median(greens), b: median(blues) };
}
