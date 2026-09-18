import { pathToFileURL } from "node:url";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { removeBackgroundInput, removeBackgroundOutput } from "../schemas.js";
import { flatBackgroundCutout } from "../services/cutout.js";
import { loadImageBytes } from "../services/images.js";
import { absolutePath, appendGeneration, getGeneration, writeAsset } from "../services/library.js";
import type { GenerationRecord } from "../types.js";
import { describeError, newId, previewBlocks, toolError, toolResult } from "./shared.js";

/** Below this, the background almost certainly was not flat and the result is unreliable. */
const LOW_REMOVAL_RATIO = 0.05;

const DESCRIPTION = `Strip the flat background from an image, writing a transparent PNG.

Runs locally: samples the background colour from the image border, flood-fills
the connected background region from the edges, and feathers the boundary. No
API key, no network round trip, no cost.

This is a keyer, not a matting model. It is exact on the flat-background artwork
this server generates, and unreliable on photographs or busy backgrounds - check
'removed_ratio' in the result, which is near zero when the background was not flat.

Args:
  - imageUrl (string, optional): url of the image to cut out
  - imageId (string, optional): id of an image generated earlier
  Exactly one of imageUrl or imageId is required.
  - include_preview (bool, optional): also return a downscaled inline image.
    Previews of cutouts keep their alpha channel, so transparency is visible

Returns:
  { id, path, width, height, source_id?, source_url, removed_ratio,
    background_color, note? }

  The PNG is written under library/assets/ and registered like any other
  generation, so its 'id' can be passed to save_to_library. There is no url
  because nothing was uploaded - the file is local.

Examples:
  - "cut out the background on that icon" -> imageId=<the icon's id>
  - "make this logo transparent" -> imageUrl=<url>

Errors:
  - "Provide exactly one of imageUrl or imageId" if both or neither are given
  - "No generation found with id '<id>'" if imageId is unknown
  - A 'note' rather than an error when the background was not flat enough`;

export function registerRemoveBackground(server: McpServer): void {
  server.registerTool(
    "remove_background",
    {
      title: "Remove Background",
      description: DESCRIPTION,
      inputSchema: removeBackgroundInput,
      outputSchema: removeBackgroundOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        if ((args.imageUrl && args.imageId) || (!args.imageUrl && !args.imageId)) {
          return toolError("Provide exactly one of imageUrl or imageId.");
        }

        let source: string;
        let sourceRecord: GenerationRecord | undefined;

        if (args.imageId) {
          sourceRecord = await getGeneration(args.imageId);
          if (!sourceRecord) {
            return toolError(
              `No generation found with id '${args.imageId}'. Ids come from generate_image or ` +
                "generate_icon_set; pass imageUrl instead for an image this server did not make.",
            );
          }
          source = sourceRecord.path ?? sourceRecord.url;
        } else {
          source = args.imageUrl!;
        }

        const cutout = await flatBackgroundCutout(await loadImageBytes(source));

        const id = newId("cut");
        const path = await writeAsset(cutout.png, id, "png");
        const { r, g, b } = cutout.backgroundColor;

        const record: GenerationRecord = {
          id,
          url: pathToFileURL(absolutePath(path)).href,
          path,
          prompt: sourceRecord?.prompt ?? "background removed",
          fullPrompt: sourceRecord?.fullPrompt ?? "",
          negativePrompt: "",
          provider: "local",
          model: sourceRecord?.model ?? "schnell",
          modelId: "local:flat-background-key",
          params: sourceRecord?.params ?? {
            image_size: "square_hd",
            num_inference_steps: 0,
            output_format: "png",
            enable_safety_checker: false,
          },
          seed: sourceRecord?.seed ?? 0,
          styleId: sourceRecord?.styleId ?? "n/a",
          sourceId: sourceRecord?.id,
          kind: "cutout",
          createdAt: new Date().toISOString(),
        };
        await appendGeneration(record);

        const note =
          cutout.removedRatio < LOW_REMOVAL_RATIO
            ? `Only ${(cutout.removedRatio * 100).toFixed(1)}% of pixels were removed. This image ` +
              "probably does not have a flat background - the keyer handles generated icons, not photographs."
            : undefined;

        const output = {
          id,
          path,
          width: cutout.width,
          height: cutout.height,
          source_id: sourceRecord?.id,
          source_url: source,
          removed_ratio: Number(cutout.removedRatio.toFixed(4)),
          background_color: `rgb(${r}, ${g}, ${b})`,
          ...(note ? { note } : {}),
        };

        const summary = [
          `Cut out ${id}: keyed rgb(${r}, ${g}, ${b}) and made ${(cutout.removedRatio * 100).toFixed(1)}% of pixels transparent.`,
          `Saved to ${path}`,
          note ?? "",
        ]
          .filter(Boolean)
          .join("\n");

        return toolResult(summary, output, await previewBlocks(args.include_preview, [path]));
      } catch (error) {
        return toolError(describeError(error));
      }
    },
  );
}
