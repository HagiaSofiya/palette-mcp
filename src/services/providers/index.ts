import { DEFAULT_PROVIDER, PROVIDER_IDS, type ProviderId } from "../../constants.js";
import { cloudflareProvider } from "./cloudflare.js";
import { falProvider } from "./fal.js";
import { togetherProvider } from "./together.js";
import type { ImageProvider } from "./types.js";

export { ProviderError } from "./types.js";
export type { GenerateRequest, GeneratedImage, ImageProvider } from "./types.js";

const PROVIDERS: Record<ProviderId, ImageProvider> = {
  cloudflare: cloudflareProvider,
  together: togetherProvider,
  fal: falProvider,
};

/**
 * Pick the image backend. Defaults to Cloudflare Workers AI, whose free daily
 * Neuron allocation costs nothing and needs no deposit. PALETTE_PROVIDER=together
 * or =fal select the alternatives.
 */
export function resolveProvider(): ImageProvider {
  const requested = process.env.PALETTE_PROVIDER?.trim().toLowerCase();
  if (!requested) return PROVIDERS[DEFAULT_PROVIDER];

  if (!(PROVIDER_IDS as readonly string[]).includes(requested)) {
    throw new Error(
      `Unknown PALETTE_PROVIDER '${requested}'. Valid values: ${PROVIDER_IDS.join(", ")}.`,
    );
  }
  return PROVIDERS[requested as ProviderId];
}
