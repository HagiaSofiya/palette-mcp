import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { generateIconSetInput, generateIconSetOutput } from "../schemas.js";
import { appendGeneration } from "../services/library.js";
import { resolveProvider } from "../services/providers/index.js";
import { composePrompt, resolveStyle } from "../styles.js";
import type { GenerationRecord } from "../types.js";
import { modelIdFor } from "./generateImage.js";
import {
  describeError,
  mapWithConcurrency,
  materialize,
  newId,
  previewBlocks,
  randomSeed,
  toolError,
  toolResult,
  withRetry,
} from "./shared.js";

const DESCRIPTION = `Generate a cohesive icon set - one icon per concept, all sharing one visual style.

Cohesion is structural, not a matter of prompt wording. The style preset is
resolved once, then the same seed, the same palette and the same model
parameter object are applied to every concept in the set. The only thing that
varies between icons is the concept noun.

Args:
  - concepts (string[]): 1-12 short nouns, e.g. ['inbox', 'calendar', 'settings']
  - style (string, optional): preset id ('flat-minimal', 'line-art', 'soft-3d',
    'duotone-glyph') or free-form style text. Default 'flat-minimal'
  - model ('schnell' | 'dev', optional): default 'schnell', which is free on
    Cloudflare Workers AI. 'dev' is higher quality but uses more of the daily
    free allocation
  - seed (int, optional): shared by every icon. Omit for random. Pass a seed
    returned by an earlier set, with the same style, to add matching icons later
  - include_preview (bool, optional): return downscaled inline images. Useful for
    judging cohesion, but costs context for every icon in the set

Returns:
  { set_id, style_id, provider, model, model_id, seed, params, palette,
    requested, succeeded,
    icons: [{ concept, ok, id?, url?, full_prompt?, error? }] }

  Concepts are generated concurrently and reported individually: one failure
  does not discard the icons that succeeded. Check 'succeeded' against
  'requested', and retry only the concepts whose 'ok' is false.

Examples:
  - "icons for a habit tracker" -> concepts=['streak flame', 'checklist',
    'calendar', 'trophy', 'bar chart'], style='flat-minimal'
  - "outline icons matching the set I made earlier" -> pass the earlier set's
    seed and the same style

Errors:
  - "CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN is not set" if credentials are missing
  - Concepts are generated a few at a time and rate-limit failures are retried
    with backoff, so a large set degrades gracefully rather than failing whole`;

export function registerGenerateIconSet(server: McpServer): void {
  server.registerTool(
    "generate_icon_set",
    {
      title: "Generate Icon Set",
      description: DESCRIPTION,
      inputSchema: generateIconSetInput,
      outputSchema: generateIconSetOutput,
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

        // Everything that defines the look is resolved exactly once, here, and
        // the same objects are handed to every concept below. There is no
        // per-concept code path that can re-derive any of it - that is what
        // makes the set cohesive by construction rather than by prompt wording.
        const preset = resolveStyle(args.style, args.model);
        const params = preset.params;
        const seed = args.seed ?? randomSeed();
        const modelId = modelIdFor(provider.id, args.model);
        const setId = newId("set");

        const results = await mapWithConcurrency(args.concepts, async (concept) => {
          const { prompt, negativePrompt } = composePrompt(`${concept} icon`, preset);

          const iconId = newId("icon");
          const image = await materialize(
            await withRetry(() =>
              provider.generate({ prompt, negativePrompt, model: args.model, params, seed }),
            ),
            iconId,
          );

          const record: GenerationRecord = {
            id: iconId,
            url: image.url,
            ...(image.path ? { path: image.path } : {}),
            prompt: concept,
            fullPrompt: prompt,
            negativePrompt,
            provider: provider.id,
            model: args.model,
            modelId,
            params,
            seed,
            styleId: preset.id,
            setId,
            concept,
            kind: "icon",
            createdAt: new Date().toISOString(),
          };
          await appendGeneration(record);
          return record;
        });

        const icons = results.map((result, index) => {
          const concept = args.concepts[index]!;
          return result.ok
            ? {
                concept,
                ok: true,
                id: result.value.id,
                url: result.value.url,
                full_prompt: result.value.fullPrompt,
              }
            : { concept, ok: false, error: result.error };
        });

        const succeeded = icons.filter((icon) => icon.ok).length;

        const output = {
          set_id: setId,
          style_id: preset.id,
          provider: provider.id,
          model: args.model,
          model_id: modelId,
          seed,
          params,
          palette: preset.palette,
          requested: args.concepts.length,
          succeeded,
          icons,
        };

        const lines = [
          `Set ${setId}: ${succeeded}/${args.concepts.length} icons generated.`,
          `Held constant across every icon - style '${preset.id}', seed ${seed}, palette ${preset.palette.join(" ")}, ${modelId}, ${JSON.stringify(params)}.`,
          "",
          ...results.map((result, index) => {
            const concept = args.concepts[index]!;
            return result.ok
              ? `  ${concept}: ${result.value.path ?? result.value.url}`
              : `  ${concept}: FAILED - ${result.error}`;
          }),
        ];
        if (succeeded < args.concepts.length) {
          lines.push("", "Retry only the failed concepts; the successful ones are already registered.");
        }

        const previewUrls = results.flatMap((result) =>
          result.ok ? [result.value.path ?? result.value.url] : [],
        );
        return toolResult(
          lines.join("\n"),
          output,
          await previewBlocks(args.include_preview, previewUrls),
        );
      } catch (error) {
        return toolError(describeError(error));
      }
    },
  );
}
