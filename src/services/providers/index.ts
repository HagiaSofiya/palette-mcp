import { DEFAULT_PROVIDER, PROVIDER_IDS, type ProviderId } from "../../constants.js";
import { falProvider } from "./fal.js";
import { togetherProvider } from "./together.js";
import type { ImageProvider } from "./types.js";

export { ProviderError } from "./types.js";
export type { GenerateRequest, GeneratedImage, ImageProvider } from "./types.js";

const PROVIDERS: Record<ProviderId, ImageProvider> = {
  together: togetherProvider,
  fal: falProvider,
};

/**
 * Pick the image backend. Defaults to Together AI, whose FLUX.1-schnell-Free
 * tier costs nothing; set PALETTE_PROVIDER=fal to use the paid fal.ai path.
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
