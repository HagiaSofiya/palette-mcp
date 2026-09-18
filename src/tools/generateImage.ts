import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { FAL_MODELS, TOGETHER_MODELS } from "../constants.js";
import { generateImageInput, generateImageOutput } from "../schemas.js";
import { appendGeneration } from "../services/library.js";
import { resolveProvider } from "../services/providers/index.js";
import { composePrompt, resolveStyle } from "../styles.js";
import type { GenerationRecord, LockedParams } from "../types.js";
import {
  describeError,
  newId,
  previewBlocks,
  randomSeed,
  toolError,
  toolResult,
  withRetry,
} from "./shared.js";

/** The concrete model id a provider will invoke, recorded for traceability. */
export function modelIdFor(providerId: string, model: "schnell" | "dev"): string {
  return providerId === "fal" ? FAL_MODELS[model] : TOGETHER_MODELS[model];
}

const DESCRIPTION = `Generate a single image with FLUX.1.

Applies a style preset so the result is consistent with anything else generated
under the same style. For a group of icons that must look like one family, use
generate_icon_set instead - it locks the seed and model parameters across the
whole set, which this tool cannot do for separate calls.

Args:
  - prompt (string): what to depict, in plain language
  - style (string, optional): preset id ('flat-minimal', 'line-art', 'soft-3d',
    'duotone-glyph') or free-form style text. Default 'flat-minimal'
  - aspect_ratio (enum, optional): square_hd | square | portrait_4_3 |
    portrait_16_9 | landscape_4_3 | landscape_16_9. Default 'square_hd'
  - model ('schnell' | 'dev', optional): default 'schnell', which is free on
    Together AI. 'dev' is higher quality but paid on every provider
  - seed (int, optional): omit for random; the seed used is always returned
  - include_preview (bool, optional): also return a downscaled inline image

Returns:
  { id, url, width, height, prompt, full_prompt, style_id, provider, model,
    model_id, seed, params }

  'id' is what you pass to generate_variations, remove_background or
  save_to_library. 'url' is a fal.ai CDN link that expires - call
  save_to_library to keep the asset permanently.

Examples:
  - "a paper airplane icon" -> prompt="paper airplane"
  - "a wide banner of a mountain range at dusk, painterly"
    -> prompt="mountain range at dusk", style="painterly oil texture",
       aspect_ratio="landscape_16_9"

Errors:
  - "TOGETHER_API_KEY is not set" if credentials are missing
  - 429 if the provider's rate limit is hit; transient failures are retried
    automatically with backoff before the error surfaces`;

export function registerGenerateImage(server: McpServer): void {
  server.registerTool(
    "generate_image",
    {
      title: "Generate Image",
      description: DESCRIPTION,
      inputSchema: generateImageInput,
      outputSchema: generateImageOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const provider = resolveProvider();
        const preset = resolveStyle(args.style, args.model);
        // aspect_ratio is a per-image choice, so it overrides the preset default here.
        // generate_icon_set deliberately exposes no such knob.
        const params: LockedParams = { ...preset.params, image_size: args.aspect_ratio };
        const seed = args.seed ?? randomSeed();
        const { prompt, negativePrompt } = composePrompt(args.prompt, preset);

        const image = await withRetry(() =>
          provider.generate({ prompt, negativePrompt, model: args.model, params, seed }),
        );

        const record: GenerationRecord = {
          id: newId("img"),
          url: image.url,
          prompt: args.prompt,
          fullPrompt: prompt,
          negativePrompt,
          provider: provider.id,
          model: args.model,
          modelId: modelIdFor(provider.id, args.model),
          params,
          seed,
          styleId: preset.id,
          kind: "image",
          createdAt: new Date().toISOString(),
        };
        await appendGeneration(record);

        const output = {
          id: record.id,
          url: record.url,
          width: image.width,
          height: image.height,
          prompt: record.prompt,
          full_prompt: record.fullPrompt,
          style_id: record.styleId,
          provider: record.provider,
          model: record.model,
          model_id: record.modelId,
          seed: record.seed,
          params: record.params,
        };

        const summary = [
          `Generated ${record.id} in style '${record.styleId}' via ${provider.label} (${record.modelId}, seed ${record.seed}).`,
          record.url,
          "The url expires - call save_to_library to keep it.",
        ].join("\n");

        return toolResult(summary, output, await previewBlocks(args.include_preview, [record.url]));
      } catch (error) {
        return toolError(describeError(error));
      }
    },
  );
}
