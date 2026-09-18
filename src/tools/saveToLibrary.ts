import { existsSync } from "node:fs";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { saveToLibraryInput, saveToLibraryOutput } from "../schemas.js";
import {
  absolutePath,
  appendLibraryEntry,
  downloadAsset,
  getGeneration,
} from "../services/library.js";
import type { GenerationRecord, LibraryEntry } from "../types.js";
import { describeError, newId, toolError, toolResult } from "./shared.js";

const DESCRIPTION = `Download an image into the local asset library and index it.

fal.ai CDN urls expire. This is the only way an asset survives; call it for
anything worth keeping. The file lands in library/assets/ and an entry is
appended to library/index.json, which persists across server restarts.

Args:
  - imageUrl (string, optional): url of the image to save
  - imageId (string, optional): id of an image generated earlier. Preferred,
    because the original prompt is then recorded alongside the asset
  Exactly one of imageUrl or imageId is required.
  - tags (string[], optional): tags for later retrieval via list_library

Returns:
  { id, path, prompt, tags, timestamp, url, source_id? }

  'path' is relative to the server package root.

Examples:
  - "save the calendar and inbox icons, tag them 'habit-tracker'"
    -> one call per icon, tags=['habit-tracker']

Errors:
  - "Provide exactly one of imageUrl or imageId" if both or neither are given
  - "Could not download <url>" if the url has already expired`;

export function registerSaveToLibrary(server: McpServer): void {
  server.registerTool(
    "save_to_library",
    {
      title: "Save To Library",
      description: DESCRIPTION,
      inputSchema: saveToLibraryInput,
      outputSchema: saveToLibraryOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        if ((args.imageUrl && args.imageId) || (!args.imageUrl && !args.imageId)) {
          return toolError("Provide exactly one of imageUrl or imageId.");
        }

        let record: GenerationRecord | undefined;
        if (args.imageId) {
          record = await getGeneration(args.imageId);
          if (!record) {
            return toolError(
              `No generation found with id '${args.imageId}'. Ids come from generate_image, ` +
                "generate_icon_set, generate_variations or remove_background.",
            );
          }
        }

        const id = newId("asset");
        const source = args.imageUrl ?? record!.url;

        // A cutout already lives in library/assets/, so indexing it needs no copy.
        const path =
          record?.path && existsSync(absolutePath(record.path))
            ? record.path
            : await downloadAsset(source, id, record?.params.output_format === "jpeg" ? "image/jpeg" : "image/png");

        const entry: LibraryEntry = {
          id,
          path,
          prompt: record?.prompt ?? "(saved from a url, no prompt recorded)",
          tags: args.tags,
          timestamp: new Date().toISOString(),
          url: source,
          ...(record ? { sourceId: record.id } : {}),
        };
        await appendLibraryEntry(entry);

        const output = {
          id: entry.id,
          path: entry.path,
          prompt: entry.prompt,
          tags: entry.tags,
          timestamp: entry.timestamp,
          url: entry.url,
          ...(entry.sourceId ? { source_id: entry.sourceId } : {}),
        };

        const summary = [
          `Saved ${entry.id} to ${entry.path}`,
          entry.tags.length > 0 ? `Tags: ${entry.tags.join(", ")}` : "No tags - list_library can filter by tag.",
        ].join("\n");

        return toolResult(summary, output);
      } catch (error) {
        return toolError(describeError(error));
      }
    },
  );
}
