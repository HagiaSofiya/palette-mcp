import type { LockedParams, StylePreset } from "./types.js";
import { DEV_STEPS, SCHNELL_STEPS, type ModelKey } from "./constants.js";

/**
 * Style presets are the cohesion mechanism.
 *
 * A preset bundles three things that must not drift across a set:
 *   1. `promptSuffix` - the style language, appended verbatim to every concept
 *   2. `palette`      - literal hex codes, injected identically into every prompt
 *   3. `params`       - the fal.ai model parameters, locked as one object
 *
 * `generate_icon_set` resolves the preset once, then reuses that single object
 * for every concept. There is no per-concept path that can re-derive a value,
 * which is what makes the guarantee structural rather than a matter of prompt
 * wording.
 */

const DEV_PARAMS: LockedParams = {
  image_size: "square_hd",
  num_inference_steps: DEV_STEPS,
  guidance_scale: 3.5,
  output_format: "png",
  enable_safety_checker: true,
};

export const STYLE_PRESETS: Record<string, StylePreset> = {
  "flat-minimal": {
    id: "flat-minimal",
    description: "Flat vector icon, solid fills, geometric, no depth cues.",
    promptSuffix:
      "minimalist flat vector icon, single centered symbol, simple geometric silhouette, " +
      "uniform thick strokes, pure white background, wide even white margin around the symbol, " +
      "plain flat vector illustration",
    palette: ["#1E3A8A", "#22B8F0", "#FFFFFF"],
    paletteWords: "solid deep navy and bright azure blue shapes on white",
    avoid: "text, letters, gradients, drop shadows, photorealism, 3D bevel, watermark, background panel",
    params: DEV_PARAMS,
  },
  "line-art": {
    id: "line-art",
    description: "Monoline stroke icon with a single uniform stroke weight.",
    promptSuffix:
      "minimalist monoline outline icon, single centered symbol drawn in one continuous uniform " +
      "stroke weight, rounded line caps, open unfilled shapes, pure white background, wide even " +
      "white margin around the symbol, plain line drawing",
    palette: ["#111827", "#6B7280", "#FFFFFF"],
    paletteWords: "thin charcoal grey outlines on white",
    avoid: "text, letters, filled shapes, gradients, shadows, varying line thickness, watermark",
    params: DEV_PARAMS,
  },
  "soft-3d": {
    id: "soft-3d",
    description: "Soft matte clay render with rounded edges and gentle studio light.",
    promptSuffix:
      "soft 3D clay render of a single centered object, matte plastic material, rounded chamfered " +
      "edges, gentle diffuse studio lighting from the upper left, soft contact shadow, plain pale " +
      "background, wide even margin around the object",
    palette: ["#F97316", "#7C3AED", "#F8FAFC"],
    paletteWords: "warm orange and soft violet matte clay on a pale grey backdrop",
    avoid: "text, letters, harsh specular highlights, busy background, watermark",
    params: DEV_PARAMS,
  },
  "duotone-glyph": {
    id: "duotone-glyph",
    description: "Two-tone solid glyph: one accent colour over one base colour.",
    promptSuffix:
      "bold duotone glyph icon, single centered pictogram in exactly two solid colours, simplified " +
      "high contrast silhouette, pure white background, wide even white margin around the symbol, " +
      "flat vector pictogram",
    palette: ["#DB2777", "#1E1B4B", "#FFFFFF"],
    paletteWords: "solid magenta pink and deep indigo shapes on white",
    avoid: "text, letters, third colour, gradients, shadows, fine detail, watermark",
    params: DEV_PARAMS,
  },
};

export const DEFAULT_STYLE_ID = "flat-minimal";

/** Preset ids, for tool descriptions and error messages. */
export const STYLE_IDS = Object.keys(STYLE_PRESETS);

/**
 * Adapt locked params to the target model.
 *
 * schnell is a 4-step distilled model that does not accept `guidance_scale`;
 * sending one is a 422. This is the only place model shape is special-cased.
 */
function paramsForModel(params: LockedParams, model: ModelKey): LockedParams {
  if (model === "schnell") {
    const { guidance_scale: _omit, ...rest } = params;
    return { ...rest, num_inference_steps: SCHNELL_STEPS };
  }
  return { ...params, num_inference_steps: DEV_STEPS };
}

/**
 * Resolve the `style` argument to a concrete preset.
 *
 * Accepts a built-in preset id, or free text. Free text becomes the prompt
 * suffix of a synthesized preset that keeps flat-minimal's locked params, so an
 * ad-hoc style is still held constant across a set exactly like a built-in one.
 */
export function resolveStyle(style: string | undefined, model: ModelKey): StylePreset {
  const key = style?.trim().toLowerCase() ?? "";
  const builtin = STYLE_PRESETS[key] ?? (key === "" ? STYLE_PRESETS[DEFAULT_STYLE_ID] : undefined);

  if (builtin) {
    return { ...builtin, params: paramsForModel(builtin.params, model) };
  }

  const base = STYLE_PRESETS[DEFAULT_STYLE_ID]!;
  return {
    id: `custom:${key}`,
    description: `Ad-hoc style: ${style}`,
    promptSuffix: style!.trim(),
    palette: base.palette,
    paletteWords: base.paletteWords,
    avoid: base.avoid,
    params: paramsForModel(base.params, model),
  };
}

export interface ComposedPrompt {
  prompt: string;
  negativePrompt: string;
}

/**
 * Compose what is actually sent to the provider.
 *
 * Deterministic given (subject, preset): the same preset produces byte-identical
 * style and palette segments for every subject in a set, which is what makes a
 * set cohesive rather than merely similarly-worded.
 *
 * Exclusions are returned separately. Providers with a real negative_prompt
 * field pass them as one; the rest append them to the positive prompt.
 */
export function composePrompt(subject: string, preset: StylePreset): ComposedPrompt {
  return {
    prompt: [
      subject.trim(),
      preset.promptSuffix,
      preset.paletteWords,
    ]
      .filter(Boolean)
      .join(". "),
    negativePrompt: preset.avoid,
  };
}
