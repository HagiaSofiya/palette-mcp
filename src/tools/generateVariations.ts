import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { generateVariationsInput, generateVariationsOutput } from "../schemas.js";
import { appendGeneration, getGeneration } from "../services/library.js";
import { resolveProvider } from "../services/providers/index.js";
import type { GenerationRecord } from "../types.js";
import {
  describeError,
  mapWithConcurrency,
  newId,
  previewBlocks,
  randomSeed,
  toolError,
  toolResult,
  withRetry,
} from "./shared.js";

const DESCRIPTION = `Generate n variations of an image this server generated earlier.

Looks the image up in the generation registry and re-runs its exact prompt,
style and locked parameters with fresh seeds. The variations are therefore
siblings of the original - same subject, same style - rather than re-edits of
its pixels.

Args:
  - imageId (string): an id returned by generate_image or generate_icon_set
  - n (int, optional): how many variations, 1-8. Default 3
  - include_preview (bool, optional): also return downscaled inline images

Returns:
  { source_id, source_prompt, style_id, model, requested, succeeded,
    variations: [{ ok, id?, url?, seed?, error? }] }

  Each variation reports its own seed, so a result you like can be reproduced
  exactly by passing that seed back to generate_image.

Examples:
  - "give me three more like the second icon" -> imageId=<that icon's id>, n=3

Errors:
  - "No generation found with id '<id>'" if the id is unknown. Only images this
    server generated can be varied; an arbitrary url cannot, because the
    original prompt and parameters are not recoverable from it`;

export function registerGenerateVariations(server: McpServer): void {
  server.registerTool(
    "generate_variations",
    {
      title: "Generate Variations",
      description: DESCRIPTION,
      inputSchema: generateVariationsInput,
      outputSchema: generateVariationsOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const source = await getGeneration(args.imageId);
        if (!source) {
          return toolError(
            `No generation found with id '${args.imageId}'. Only images this server generated can ` +
              "be varied, because the original prompt and locked parameters are not recoverable " +
              "from a bare url.",
          );
        }

        if (source.kind === "cutout") {
          return toolError(
            `'${args.imageId}' is a background-removed cutout, which has no prompt of its own. ` +
              (source.sourceId
                ? `Vary the image it came from instead: ${source.sourceId}.`
                : "Vary the original generated image instead."),
          );
        }

        const provider = resolveProvider();

        // Reuse the source's composed prompt and locked params verbatim, changing
        // only the seed. The variations are therefore siblings of the original -
        // same subject, same style - rather than re-edits of its pixels.
        const seeds = Array.from({ length: args.n }, () => randomSeed());

        const results = await mapWithConcurrency(seeds, async (seed) => {
          const image = await withRetry(() =>
            provider.generate({
              prompt: source.fullPrompt,
              negativePrompt: source.negativePrompt,
              model: source.model,
              params: source.params,
              seed,
            }),
          );

          const record: GenerationRecord = {
            id: newId("var"),
            url: image.url,
            prompt: source.prompt,
            fullPrompt: source.fullPrompt,
            negativePrompt: source.negativePrompt,
            provider: provider.id,
            model: source.model,
            modelId: source.modelId,
            params: source.params,
            seed,
            styleId: source.styleId,
            setId: source.setId,
            concept: source.concept,
            sourceId: source.id,
            kind: "variation",
            createdAt: new Date().toISOString(),
          };
          await appendGeneration(record);
          return record;
        });

        const variations = results.map((result, index) =>
          result.ok
            ? { ok: true, id: result.value.id, url: result.value.url, seed: result.value.seed }
            : { ok: false, seed: seeds[index]!, error: result.error },
        );

        const succeeded = variations.filter((variation) => variation.ok).length;

        const output = {
          source_id: source.id,
          source_prompt: source.prompt,
          style_id: source.styleId,
          provider: provider.id,
          model: source.model,
          requested: args.n,
          succeeded,
          variations,
        };

        const summary = [
          `${succeeded}/${args.n} variations of ${source.id} ("${source.prompt}"), style '${source.styleId}'.`,
          ...variations.map((variation) =>
            variation.ok
              ? `  seed ${variation.seed}: ${variation.url}  (${variation.id})`
              : `  seed ${variation.seed}: FAILED - ${variation.error}`,
          ),
          "",
          "Each variation reports its seed - pass one back to generate_image to reproduce it exactly.",
        ].join("\n");

        const previewUrls = variations.flatMap((variation) =>
          variation.ok && variation.url ? [variation.url] : [],
        );
        return toolResult(summary, output, await previewBlocks(args.include_preview, previewUrls));
      } catch (error) {
        return toolError(describeError(error));
      }
    },
  );
}
