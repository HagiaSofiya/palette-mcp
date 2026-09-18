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
    description: "Flat vector UI icon, solid fills, geometric, no depth cues.",
    promptSuffix:
      "flat vector icon, solid fill shapes, clean geometric forms, thick rounded corners, " +
      "centered composition on a plain white background, generous even margins, app icon design",
    palette: ["#2563EB", "#38BDF8", "#0F172A", "#FFFFFF"],
    avoid:
      "no text, no letters, no gradients, no drop shadows, no photorealism, no 3D bevel, no watermark",
    params: DEV_PARAMS,
  },
  "line-art": {
    id: "line-art",
    description: "Monoline stroke icon with a single uniform stroke weight.",
    promptSuffix:
      "monoline outline icon, single uniform stroke weight, rounded line caps, no fill, " +
      "centered composition on a plain white background, generous even margins, minimal linework",
    palette: ["#111827", "#6B7280", "#FFFFFF"],
    avoid:
      "no text, no letters, no filled shapes, no gradients, no shadows, no varying line thickness, no watermark",
    params: DEV_PARAMS,
  },
  "soft-3d": {
    id: "soft-3d",
    description: "Soft matte clay render with rounded edges and gentle studio light.",
    promptSuffix:
      "soft 3D clay render, matte plastic material, rounded chamfered edges, gentle diffuse studio " +
      "lighting from the upper left, subtle contact shadow, centered on a plain light background, isometric-leaning angle",
    palette: ["#F97316", "#FBBF24", "#7C3AED", "#F8FAFC"],
    avoid: "no text, no letters, no harsh specular highlights, no busy background, no watermark",
    params: DEV_PARAMS,
  },
  "duotone-glyph": {
    id: "duotone-glyph",
    description: "Two-tone solid glyph: one accent colour over one base colour.",
    promptSuffix:
      "duotone glyph icon, exactly two solid colours, bold simplified silhouette, high contrast, " +
      "centered composition on a plain white background, generous even margins, pictogram style",
    palette: ["#DB2777", "#1E1B4B", "#FFFFFF"],
    avoid:
      "no text, no letters, no third colour, no gradients, no shadows, no fine detail, no watermark",
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
      `strict colour palette: ${preset.palette.join(", ")}`,
    ]
      .filter(Boolean)
      .join(". "),
    negativePrompt: preset.avoid,
  };
}
