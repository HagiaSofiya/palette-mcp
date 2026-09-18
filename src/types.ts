import type { AspectRatio, ModelKey } from "./constants.js";

/**
 * The parameters that are locked across every image in a set.
 *
 * This object is the cohesion mechanism: `generate_icon_set` builds it once and
 * passes the *same* object to every concept, so style can never drift because a
 * per-concept code path re-derived a value. Only the concept noun varies.
 */
export interface LockedParams {
  image_size: AspectRatio;
  num_inference_steps: number;
  /** Absent on schnell, which does not accept a guidance scale. */
  guidance_scale?: number;
  output_format: "png" | "jpeg";
  enable_safety_checker: boolean;
}

export interface StylePreset {
  id: string;
  description: string;
  /** Appended verbatim to every prompt in the set. */
  promptSuffix: string;
  /** Hex codes. Reported as metadata so a set's palette is inspectable. */
  palette: string[];
  /**
   * The palette as colour words, which is what actually goes in the prompt.
   * FLUX largely ignores hex codes; named colours are followed far more reliably.
   */
  paletteWords: string;
  /** Negative guidance folded into the prompt. */
  avoid: string;
  params: LockedParams;
}

/** One generated image. Appended to library/generations.json by every generating tool. */
export interface GenerationRecord {
  id: string;
  /** Provider url, or a file:// url for locally produced images such as cutouts. */
  url: string;
  /** Package-relative path, set when the image exists on disk. */
  path?: string;
  /** What the caller asked for. */
  prompt: string;
  /** What we actually sent, after style/palette composition. */
  fullPrompt: string;
  /** Style exclusions, sent as a negative prompt where the provider supports one. */
  negativePrompt: string;
  /** Which backend produced this ('together' or 'fal'). */
  provider: string;
  model: ModelKey;
  /** The provider-specific model id, e.g. 'black-forest-labs/FLUX.1-schnell-Free'. */
  modelId: string;
  params: LockedParams;
  seed: number;
  styleId: string;
  /** Present when this image came from generate_icon_set. */
  setId?: string;
  /** The concept noun within a set. */
  concept?: string;
  /** Present when derived from another record (variation, background removal). */
  sourceId?: string;
  kind: "image" | "icon" | "variation" | "cutout";
  createdAt: string;
}

/** One saved asset. Appended to library/index.json by save_to_library. */
export interface LibraryEntry {
  id: string;
  path: string;
  prompt: string;
  tags: string[];
  timestamp: string;
  /** Traceability beyond the brief's five fields. */
  url: string;
  sourceId?: string;
}
