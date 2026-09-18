/** Shared constants. Endpoint ids and parameters are verified against each provider's API docs. */

export const SERVER_NAME = "palette-mcp-server";
export const SERVER_VERSION = "0.1.0";

/** Which backend actually generates images. Set PALETTE_PROVIDER to switch. */
export const PROVIDER_IDS = ["cloudflare", "together", "fal"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export const DEFAULT_PROVIDER: ProviderId = "cloudflare";

/**
 * Model tiers, mapped to a concrete model id by each provider.
 * 'schnell' is the free path on Together; 'dev' needs a funded account anywhere.
 */
export const MODEL_KEYS = ["schnell", "dev"] as const;
export type ModelKey = (typeof MODEL_KEYS)[number];
export const DEFAULT_MODEL: ModelKey = "schnell";

export const TOGETHER_API_URL = "https://api.together.ai/v1/images/generations";

export const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4/accounts";

export const CLOUDFLARE_MODELS: Record<ModelKey, string> = {
  schnell: "@cf/black-forest-labs/flux-1-schnell",
  dev: "@cf/black-forest-labs/flux-2-dev",
};

/** flux-1-schnell on Workers AI caps diffusion steps at 8. */
export const CLOUDFLARE_MAX_STEPS = 8;

export const TOGETHER_MODELS: Record<ModelKey, string> = {
  schnell: "black-forest-labs/FLUX.1-schnell-Free",
  dev: "black-forest-labs/FLUX.1-dev",
};

export const FAL_MODELS: Record<ModelKey, string> = {
  schnell: "fal-ai/flux/schnell",
  dev: "fal-ai/flux/dev",
};

/** FLUX schnell is a 4-step distilled model; Together's free endpoint caps steps here. */
export const SCHNELL_STEPS = 8;
export const DEV_STEPS = 28;

/** Aspect ratios, and the pixel dimensions providers that want width/height receive. */
export const ASPECT_RATIOS = [
  "square_hd",
  "square",
  "portrait_4_3",
  "portrait_16_9",
  "landscape_4_3",
  "landscape_16_9",
] as const;

export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const ASPECT_DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  square_hd: { width: 1024, height: 1024 },
  square: { width: 512, height: 512 },
  portrait_4_3: { width: 768, height: 1024 },
  portrait_16_9: { width: 576, height: 1024 },
  landscape_4_3: { width: 1024, height: 768 },
  landscape_16_9: { width: 1024, height: 576 },
};

/** Max characters in a tool's text response before we truncate and say so. */
export const CHARACTER_LIMIT = 25_000;

/** Longest edge of an inline base64 preview. Keeps a preview around 15-40KB. */
export const PREVIEW_PX = 256;
export const PREVIEW_QUALITY = 70;

/** Seeds are uint32 across both providers. */
export const MAX_SEED = 4_294_967_295;

/** Network budget for a single generation, including queue wait. */
export const REQUEST_TIMEOUT_MS = 180_000;

/**
 * Together's free tier allows roughly 10 image requests a minute, so a large
 * icon set must not fan out all at once.
 */
export const SET_CONCURRENCY = 3;
export const RATE_LIMIT_RETRIES = 3;
