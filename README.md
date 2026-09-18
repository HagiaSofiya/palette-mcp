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

For the `flat-minimal` preset, `generate_icon_set(["flame", "calendar"])` sends:

```
flame. minimalist flat vector icon, single centered symbol, simple geometric
silhouette, uniform thick strokes, pure white background, wide even white margin
around the symbol, plain flat vector illustration. solid deep navy and bright
azure blue shapes on white
```

```
calendar. minimalist flat vector icon, single centered symbol, simple geometric
silhouette, uniform thick strokes, pure white background, wide even white margin
around the symbol, plain flat vector illustration. solid deep navy and bright
azure blue shapes on white
```

…with the identical parameter object, and the identical seed **where the model accepts one**.

Two things that came out of testing this against a real model, rather than from theory:

- **Colour words beat hex codes.** FLUX largely ignores `#1E3A8A`; "solid deep navy" it follows.
  The preset keeps the hex values as reportable metadata and puts words in the prompt.
- **Exclusions never go in the positive prompt.** On providers without a `negative_prompt`
  field they are dropped, not appended — diffusion models handle negation poorly, and
  "no gradients" in a positive prompt reliably produces gradients.

The response reports exactly what was held constant, and says so when a lock could *not* be
applied, so the claim is auditable rather than asserted:

```
Held constant across every icon - style 'flat-minimal', palette #1E3A8A #22B8F0 #FFFFFF,
@cf/black-forest-labs/flux-1-schnell, {"image_size":"square_hd","num_inference_steps":8,...}
Seed 4049081962 was NOT applied - @cf/black-forest-labs/flux-1-schnell rejects a seed,
so the icons do not share initial noise.
```

Where the model does accept a seed, a returned seed can be passed back later with the same
style to extend an existing set with matching icons.

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

Measured, not assumed:

- **Cloudflare's `flux-1-schnell` rejects `seed` outright**, despite the Workers AI docs listing
  it as supported. The live API returns
  `Additional or unevaluated properties '/seed' at '/' not allowed`. On that provider the seed
  lock — the strongest cohesion lever — is simply unavailable, and the tools say so in their
  output instead of pretending otherwise. Together AI and fal.ai do honour seeds.
- **Cohesion on the free tier is good, not perfect.** With the locked style, palette and
  parameters, a set shares background, colour and visual language. Composition and framing still
  drift, and 4–8 step distilled models sometimes miss a concept outright. A seeded provider and
  a `dev`-class model tighten this considerably.
- **A shared seed correlates composition, it doesn't guarantee it.** Most of the cohesion comes
  from the locked style suffix, palette and parameters. The seed adds structural correlation on
  top; it is not magic.
- **`flux-1-schnell` has a fixed output size**, so a non-square `aspect_ratio` is reported back
  as an explicit warning rather than silently dropped. `flux-2-dev` on Workers AI needs a
  `multipart` request this server does not yet implement.
- **The safety filter false-positives.** The concept "streak flame" was rejected as NSFW
  (`code 8007`) because "streak" reads as "streaking". Per-concept failures are isolated, so the
  rest of the set still lands — rename the concept and retry just that one.
- **`remove_background` is a keyer, not a matting model.** Flat backgrounds only; it reports
  `removed_ratio` so you can tell when it didn't work.
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
