# palette-mcp

An [MCP](https://modelcontextprotocol.io) server that generates **cohesive UI asset sets** —
icons, images, variations — through FLUX.1 models, with a local asset library that survives
restarts.

The interesting part isn't "call an image API from an LLM." It's `generate_icon_set`: making a
set of icons that genuinely look like they belong together.

---

## The idea: cohesion by construction, not by prompt wording

The naive way to make a matching icon set is to paste the same style words into every prompt and
hope. That drifts — diffusion models are free to reinterpret "minimal flat icon" differently for
"inbox" than for "calendar".

`palette-mcp` resolves the style **once** per call and reuses the same objects for every concept:

```
resolveStyle(style, model)  ->  one StylePreset
  .promptSuffix   the style language, appended verbatim to every concept
  .palette        literal hex codes, injected identically into every prompt
  .avoid          exclusions, sent as a real negative prompt where supported
  .params         model parameters, as ONE object handed to every request

randomSeed()      ->  one seed, shared by every concept in the set
```

There is no per-concept code path that can re-derive any of it. The **only** thing that varies
between requests is the concept noun.

For the `flat-minimal` preset, `generate_icon_set(["inbox", "calendar"])` sends:

```
inbox icon. flat vector icon, solid fill shapes, clean geometric forms, thick rounded
corners, centered composition on a plain white background, generous even margins, app
icon design. strict colour palette: #2563EB, #38BDF8, #0F172A, #FFFFFF
```

```
calendar icon. flat vector icon, solid fill shapes, clean geometric forms, thick rounded
corners, centered composition on a plain white background, generous even margins, app
icon design. strict colour palette: #2563EB, #38BDF8, #0F172A, #FFFFFF
```

…both with `negative_prompt: "no text, no letters, no gradients, no drop shadows, no
photorealism, no 3D bevel, no watermark"`, the identical seed, and the identical parameter
object. The response reports exactly what was held constant, so the claim is auditable rather
than asserted:

```
Held constant across every icon - style 'flat-minimal', seed 673260276,
palette #2563EB #38BDF8 #0F172A #FFFFFF, @cf/black-forest-labs/flux-1-schnell,
{"image_size":"square_hd","num_inference_steps":4,"output_format":"png",...}
```

A returned seed can be passed back later, with the same style, to extend an existing set with
matching icons.

---

## Quick start

Requires **Node 20.9+**.

```bash
git clone git@github.com:HagiaSofiya/palette-mcp.git
cd palette-mcp
npm install
npm run build
cp .env.example .env     # then fill in one provider below
```

### Pick a provider

| Provider | Model | Cost | Setup |
|---|---|---|---|
| **Cloudflare Workers AI** *(default)* | FLUX.1 [schnell] / FLUX.2 [dev] | **Free** — 10,000 Neurons/day, ≈173 images, resets daily, no card | account ID + API token |
| **Together AI** | FLUX.1 [schnell] | Free tier, but the account must be out of read-only mode | API key |
| **fal.ai** | FLUX.1 [schnell] / [dev] | Paid per image | API key |

**Cloudflare (recommended, free):**

1. Account ID — [dash.cloudflare.com](https://dash.cloudflare.com), in the URL or the
   **Workers & Pages** sidebar.
2. API token — [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
   → **Create Token** → **Workers AI** template → set **Account Resources** to your account →
   **Continue to summary** → **Create Token**. Keep both permission rows the template adds:
   inference requires `Workers AI - Read` **and** `Workers AI - Edit`.

```ini
PALETTE_PROVIDER=cloudflare
CLOUDFLARE_ACCOUNT_ID=your-32-hex-account-id
CLOUDFLARE_API_TOKEN=your-token
```

**Together AI:** `PALETTE_PROVIDER=together` and `TOGETHER_API_KEY=…` from
[their API keys page](https://api.together.ai/settings/api-keys).

**fal.ai:** `PALETTE_PROVIDER=fal` and `FAL_KEY=…` from
[the fal dashboard](https://fal.ai/dashboard/keys). Bills per image.

### Connect it to Claude Desktop

Add to `claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "palette": {
      "command": "node",
      "args": ["/absolute/path/to/palette-mcp/dist/index.js"]
    }
  }
}
```

No secrets go in that file — the server reads `.env` from its own package directory, resolved
relative to the module rather than the working directory, because Claude Desktop spawns it with
an unrelated cwd.

Restart Claude Desktop, then try:

> Generate a 5-icon set for a habit tracking app in the flat-minimal style, then save the best
> three to the library tagged "habit-tracker".

### Or drive it directly

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

---

## Tools

### `generate_image`
One image. `prompt`, plus optional `style`, `aspect_ratio`, `model`, `seed`, `include_preview`.
Returns `{ id, url, prompt, full_prompt, style_id, provider, model, model_id, seed, params }`.

### `generate_icon_set`
The centrepiece. `concepts` (1–12 nouns), plus optional `style`, `model`, `seed`,
`include_preview`. Style, palette, parameters and seed are locked across the whole set.
Concepts run with bounded concurrency and are reported individually — one failure does not
discard the successes, so you retry only the concepts whose `ok` is `false`.

### `generate_variations`
`imageId`, `n` (1–8). Looks the image up in the generation registry and re-runs its stored
prompt and locked parameters with fresh seeds. The results are *siblings of the concept* — same
subject, same style — rather than re-edits of the original pixels. Each reports its own seed, so
one you like is exactly reproducible.

### `remove_background`
`imageUrl` or `imageId`. Runs **locally** — no API key, no network round trip, no cost. See
below.

### `save_to_library`
`imageUrl` or `imageId`, plus `tags`. Downloads into `library/assets/` and appends to
`library/index.json`. Provider URLs expire; this is what makes an asset permanent.

### `list_library`
`tags` (AND semantics), `limit`, `offset`. Reads the index back, newest first.

Every tool declares a full input **and** output schema with annotations, returns both
human-readable text and `structuredContent`, and fails with messages written to be actionable by
an agent rather than a human reading a stack trace.

---

## Background removal, without a 380MB dependency

Every style preset asks for a *plain background*, so the images this server produces are flat
artwork with hard edges on a uniform field. That doesn't need a matting model — it needs a
keyer. `remove_background` uses `sharp`, which is already a dependency:

1. **Sample** the background colour from the border (median, so artwork bleeding to the edge
   can't skew it) — diffusion models return cream and pale grey at least as often as pure white.
2. **Flood-fill** inward from the border, 4-connected, so background-coloured pixels *inside*
   the artwork — a highlight, the hole in a letter O — stay opaque.
3. **Feather** the boundary so edges don't alias.

The alternative was ~301MB of ONNX runtime plus an ~80MB model to do matting that an icon does
not need.

It reports `removed_ratio` and attaches a `note` when that ratio is near zero, because **this is
a keyer, not a matting model** — it does not work on photographs or busy backgrounds, and it
says so rather than returning a confidently wrong result.

---

## Asset library

```
library/
├── index.json         saved assets: { id, path, prompt, tags, timestamp, url, sourceId? }
├── generations.json   every image generated, so imageId stays resolvable across restarts
└── assets/            the files themselves
```

Two stores, because they answer different questions: `generations.json` is what makes
`generate_variations(imageId)` work after a restart, while `index.json` is the curated set you
chose to keep. Both are written through a serialised read-modify-write with atomic rename — a
5-concept set fires 5 concurrent appends, and without that the last writer would silently drop
the others.

`library/` is gitignored.

---

## Project layout

```
src/
├── index.ts              McpServer + stdio transport
├── styles.ts             the style preset registry — the cohesion mechanism
├── schemas.ts            zod input/output schemas for all six tools
├── services/
│   ├── providers/        cloudflare | together | fal behind one interface
│   ├── cutout.ts         the flat-background keyer
│   ├── library.ts        atomic, serialised JSON persistence
│   ├── images.ts         loads bytes from a url or a local path
│   └── preview.ts        downscales to a ~15-40KB inline preview
└── tools/                one file per tool
```

Providers differ in shape and the code accommodates that rather than papering over it:
Together and fal.ai host the result and return a URL; Cloudflare returns base64 bytes inline,
which get written straight into the asset folder. A `materialize` step normalises both.

---

## Honest limitations

- **`flat-minimal` on `flux-1-schnell` locks fewer parameters than on `dev`.** Schnell accepts
  only `prompt`, `steps` and `seed`, so the locked-parameter set is smaller. The seed and palette
  locks — the load-bearing parts — apply on every provider; `guidance_scale` and explicit
  dimensions only exist on `dev`.
- **A shared seed correlates composition, it doesn't guarantee it.** Most of the cohesion comes
  from the locked style suffix, palette and parameters. The seed adds structural correlation on
  top; it is not magic.
- **`flux-1-schnell` has a fixed output size.** A non-square `aspect_ratio` is reported back as
  an explicit warning rather than silently dropped. Use `model: "dev"` for real dimension control.
- **`remove_background` is a keyer.** Flat backgrounds only.
- **Tool names are unprefixed** (`generate_image`, not `palette_generate_image`), which risks
  collision if you run several image-generation MCP servers at once.

---

## Development

```bash
npm run build     # tsc
npm start         # node dist/index.js
npm run inspect   # MCP Inspector against the built server
```

MIT.
