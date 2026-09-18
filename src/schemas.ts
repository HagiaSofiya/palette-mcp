import { z } from "zod";

import { ASPECT_RATIOS, DEFAULT_MODEL, MAX_SEED, MODEL_KEYS } from "./constants.js";

/**
 * Input and output shapes for every tool.
 *
 * The MCP TypeScript SDK v1 takes `inputSchema`/`outputSchema` as raw Zod
 * shapes - plain objects of Zod types, not `z.object(...)` wrappers.
 */

const modelField = z
  .enum(MODEL_KEYS)
  .default(DEFAULT_MODEL)
  .describe(
    "Which FLUX tier to use. 'schnell' (default) is the 4-step distilled model and is free on " +
      "Together AI's FLUX.1-schnell-Free endpoint. 'dev' is higher quality at 28 steps but is a " +
      "paid model on every provider, so it fails on an unfunded account.",
  );

const styleField = z
  .string()
  .max(400)
  .optional()
  .describe(
    "A built-in preset id ('flat-minimal', 'line-art', 'soft-3d', 'duotone-glyph') or free-form " +
      "style text. Free text is treated as an ad-hoc preset and is still locked across a set. " +
      "Defaults to 'flat-minimal'.",
  );

const seedField = z
  .number()
  .int()
  .min(0)
  .max(MAX_SEED)
  .optional()
  .describe("Seed for reproducibility. Omit to get a random one; the seed used is always returned.");

const previewField = z
  .boolean()
  .default(false)
  .describe(
    "When true, also return a downscaled inline image so the result can be seen directly in chat. " +
      "Costs context - leave false when generating many images at once.",
  );

/** Repeated in several outputs; defined once. */
const lockedParamsShape = z.object({
  image_size: z.string(),
  num_inference_steps: z.number(),
  guidance_scale: z.number().optional(),
  output_format: z.string(),
  enable_safety_checker: z.boolean(),
});

const imageFields = {
  id: z.string().describe("Stable id for this image. Pass to generate_variations or save_to_library."),
  url: z.url().describe("fal.ai CDN url. These expire - use save_to_library to keep the asset."),
  width: z.number().optional(),
  height: z.number().optional(),
};

// ---------------------------------------------------------------- generate_image

export const generateImageInput = {
  prompt: z.string().min(3).max(1000).describe("What to depict, in plain language."),
  style: styleField,
  aspect_ratio: z
    .enum(ASPECT_RATIOS)
    .default("square_hd")
    .describe("Output shape. Defaults to square_hd (1024x1024)."),
  model: modelField,
  seed: seedField,
  include_preview: previewField,
};

export const generateImageOutput = {
  ...imageFields,
  prompt: z.string().describe("The prompt as supplied by the caller."),
  full_prompt: z.string().describe("The prompt actually sent, after style and palette composition."),
  style_id: z.string(),
  provider: z.string().describe("Which backend generated this ('together' or 'fal')."),
  model: z.string(),
  model_id: z.string().describe("The provider-specific model id actually invoked."),
  seed: z.number(),
  params: lockedParamsShape,
};

// ------------------------------------------------------------- generate_icon_set

export const generateIconSetInput = {
  concepts: z
    .array(z.string().min(1).max(80))
    .min(1)
    .max(12)
    .describe("One short noun per icon, e.g. ['inbox', 'calendar', 'settings']."),
  style: styleField,
  model: modelField,
  seed: seedField.describe(
    "Shared across every icon in the set. Omit for a random one. Reuse a returned seed with the " +
      "same style to extend an existing set later with matching icons.",
  ),
  include_preview: previewField,
};

export const generateIconSetOutput = {
  set_id: z.string(),
  style_id: z.string(),
  provider: z.string(),
  model: z.string(),
  model_id: z.string(),
  seed: z.number().describe("The single seed shared by every icon in this set."),
  params: lockedParamsShape.describe("The locked parameters applied identically to every icon."),
  palette: z.array(z.string()).describe("Hex codes injected identically into every prompt."),
  requested: z.number(),
  succeeded: z.number(),
  icons: z.array(
    z.object({
      concept: z.string(),
      ok: z.boolean(),
      id: z.string().optional(),
      url: z.url().optional(),
      full_prompt: z.string().optional(),
      error: z.string().optional(),
    }),
  ),
};

// ---------------------------------------------------------- generate_variations

export const generateVariationsInput = {
  imageId: z
    .string()
    .min(1)
    .describe("Id of a previously generated image, as returned by generate_image or generate_icon_set."),
  n: z.number().int().min(1).max(8).default(3).describe("How many variations to generate."),
  include_preview: previewField,
};

export const generateVariationsOutput = {
  source_id: z.string(),
  source_prompt: z.string(),
  style_id: z.string(),
  provider: z.string(),
  model: z.string(),
  requested: z.number(),
  succeeded: z.number(),
  variations: z.array(
    z.object({
      ok: z.boolean(),
      id: z.string().optional(),
      url: z.url().optional(),
      seed: z.number().optional(),
      error: z.string().optional(),
    }),
  ),
};

// ------------------------------------------------------------- remove_background

export const removeBackgroundInput = {
  imageUrl: z.url().optional().describe("Url of the image to cut out. Provide this or imageId."),
  imageId: z.string().optional().describe("Id of a previously generated image. Provide this or imageUrl."),
  include_preview: previewField,
};

export const removeBackgroundOutput = {
  id: z.string(),
  path: z.string().describe("Where the transparent PNG was written, relative to the package root."),
  width: z.number().optional(),
  height: z.number().optional(),
  source_id: z.string().optional(),
  source_url: z.string(),
  removed_ratio: z
    .number()
    .describe("Fraction of pixels made transparent. Below ~0.05 means the background was not flat."),
  background_color: z.string().describe("The background colour that was detected and keyed out."),
  note: z.string().optional().describe("A warning when the result looks unreliable."),
};

// --------------------------------------------------------------- save_to_library

export const saveToLibraryInput = {
  imageUrl: z.url().optional().describe("Url of the image to save. Provide this or imageId."),
  imageId: z.string().optional().describe("Id of a previously generated image. Provide this or imageUrl."),
  tags: z.array(z.string().min(1).max(40)).default([]).describe("Tags for later retrieval via list_library."),
};

export const saveToLibraryOutput = {
  id: z.string(),
  path: z.string().describe("Path on disk, relative to the server package root."),
  prompt: z.string(),
  tags: z.array(z.string()),
  timestamp: z.string(),
  url: z.url(),
  source_id: z.string().optional(),
};

// ----------------------------------------------------------------- list_library

export const listLibraryInput = {
  tags: z
    .array(z.string())
    .optional()
    .describe("Only return entries carrying all of these tags. Omit to list everything."),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
};

export const listLibraryOutput = {
  total: z.number(),
  count: z.number(),
  offset: z.number(),
  has_more: z.boolean(),
  next_offset: z.number().optional(),
  truncated: z.boolean().optional(),
  entries: z.array(
    z.object({
      id: z.string(),
      path: z.string(),
      prompt: z.string(),
      tags: z.array(z.string()),
      timestamp: z.string(),
      url: z.string(),
      source_id: z.string().optional(),
    }),
  ),
};
