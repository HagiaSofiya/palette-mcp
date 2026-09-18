import type { ModelKey } from "../../constants.js";
import type { LockedParams } from "../../types.js";

/**
 * One generated image.
 *
 * Providers differ in how they hand back the result: Together and fal.ai host it
 * and return a url, while Cloudflare returns the bytes inline. Exactly one of
 * `url` or `bytes` is set, and the caller materialises whichever it gets.
 */
export interface GeneratedImage {
  url?: string;
  bytes?: Buffer;
  width?: number;
  height?: number;
  contentType?: string;
  /** Requests the provider could not honour exactly, surfaced rather than hidden. */
  warnings?: string[];
  /**
   * Whether the requested seed actually reached the model.
   * False on models that reject a seed, so callers never claim a lock they did not apply.
   */
  seedApplied?: boolean;
}

export interface GenerateRequest {
  /** The composed positive prompt. */
  prompt: string;
  /** Style exclusions. Providers that lack a negative_prompt field fold this into the prompt. */
  negativePrompt: string;
  model: ModelKey;
  params: LockedParams;
  seed: number;
}

export interface ImageProvider {
  id: string;
  /** Human-readable, used in error messages and the startup banner. */
  label: string;
  /** Name of the env var holding this provider's credential. */
  credentialEnvVar: string;
  /** Where to get a key, for actionable errors. */
  signupUrl: string;
  /** Throws a ProviderError if the provider is not usable. */
  assertConfigured(): void;
  generate(request: GenerateRequest): Promise<GeneratedImage>;
}

/** Carries a message that is safe and useful to hand straight to the model. */
export class ProviderError extends Error {
  /** True when retrying after a pause is likely to succeed. */
  readonly retryable: boolean;

  constructor(message: string, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = "ProviderError";
    this.retryable = options.retryable ?? false;
  }
}
