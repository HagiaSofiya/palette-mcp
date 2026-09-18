import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { CHARACTER_LIMIT } from "../constants.js";
import { listLibraryInput, listLibraryOutput } from "../schemas.js";
import { readLibrary } from "../services/library.js";
import { describeError, toolError, toolResult } from "./shared.js";

const DESCRIPTION = `List assets saved in the local library, newest first.

Reads library/index.json. Returns only assets that were explicitly saved with
save_to_library, not every image ever generated.

Args:
  - tags (string[], optional): only entries carrying ALL of these tags
  - limit (int, optional): 1-100, default 20
  - offset (int, optional): for paging, default 0

Returns:
  { total, count, offset, has_more, next_offset?, truncated?,
    entries: [{ id, path, prompt, tags, timestamp, url, source_id? }] }

  'total' counts everything matching the tag filter; 'count' is how many came
  back in this response. When 'has_more' is true, call again with 'next_offset'.

Examples:
  - "what's in the library?" -> no args
  - "show me the habit tracker icons" -> tags=['habit-tracker']

Errors:
  - Returns an empty entries array rather than erroring when nothing matches`;

export function registerListLibrary(server: McpServer): void {
  server.registerTool(
    "list_library",
    {
      title: "List Library",
      description: DESCRIPTION,
      inputSchema: listLibraryInput,
      outputSchema: listLibraryOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const all = await readLibrary();
        const wanted = args.tags?.map((tag) => tag.toLowerCase()) ?? [];

        const matching = all
          .filter((entry) => {
            if (wanted.length === 0) return true;
            const have = entry.tags.map((tag) => tag.toLowerCase());
            return wanted.every((tag) => have.includes(tag));
          })
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

        let page = matching.slice(args.offset, args.offset + args.limit);
        const hasMore = matching.length > args.offset + page.length;

        const build = (entries: typeof page, truncated: boolean) => ({
          total: matching.length,
          count: entries.length,
          offset: args.offset,
          has_more: hasMore || truncated,
          ...(hasMore || truncated ? { next_offset: args.offset + entries.length } : {}),
          ...(truncated ? { truncated: true } : {}),
          entries: entries.map((entry) => ({
            id: entry.id,
            path: entry.path,
            prompt: entry.prompt,
            tags: entry.tags,
            timestamp: entry.timestamp,
            url: entry.url,
            ...(entry.sourceId ? { source_id: entry.sourceId } : {}),
          })),
        });

        let output = build(page, false);
        // Long prompts can make a full page overflow the response budget.
        if (JSON.stringify(output).length > CHARACTER_LIMIT) {
          page = page.slice(0, Math.max(1, Math.floor(page.length / 2)));
          output = build(page, true);
        }

        const summary =
          matching.length === 0
            ? wanted.length > 0
              ? `No library entries carry all of these tags: ${wanted.join(", ")}.`
              : "The library is empty. Use save_to_library to add a generated image."
            : [
                `${matching.length} matching asset(s); showing ${output.count} from offset ${args.offset}.`,
                ...output.entries.map(
                  (entry) =>
                    `  ${entry.id}  ${entry.path}  [${entry.tags.join(", ") || "untagged"}]  ${entry.prompt.slice(0, 60)}`,
                ),
                output.has_more ? `More available - call again with offset ${output.next_offset}.` : "",
              ]
                .filter(Boolean)
                .join("\n");

        return toolResult(summary, output);
      } catch (error) {
        return toolError(describeError(error));
      }
    },
  );
}
