import { ApiError, ValidationError, fal } from "@fal-ai/client";
import { z } from "zod";

import { FAL_MODELS, REQUEST_TIMEOUT_MS } from "../../constants.js";
import { ProviderError, type GenerateRequest, type GeneratedImage, type ImageProvider } from "./types.js";

const ResponseSchema = z.object({
  images: z
    .array(
      z.object({
        url: z.url(),
        width: z.number().int().optional(),
        height: z.number().int().optional(),
        content_type: z.string().optional(),
      }),
    )
    .min(1),
});

const SIGNUP_URL = "https://fal.ai/dashboard/keys";

let configured = false;

/**
 * fal.ai, via the queue-backed client. Both tiers bill per image, so this is the
 * paid path; it stays available for anyone who wants FLUX.1 [dev] quality.
 *
 * Flux on fal has no negative_prompt field, so exclusions are appended to the
 * positive prompt instead.
 */
export const falProvider: ImageProvider = {
  id: "fal",
  label: "fal.ai (FLUX.1)",
  credentialEnvVar: "FAL_KEY",
  signupUrl: SIGNUP_URL,

  assertConfigured(): void {
    const credentials = process.env.FAL_KEY?.trim();
    if (!credentials) {
      throw new ProviderError(
        `FAL_KEY is not set. Create a key at ${SIGNUP_URL}, then put FAL_KEY=<key> in the ` +
          "server's .env file and restart. Note that fal.ai bills per image.",
      );
    }
    if (!configured) {
      fal.config({ credentials });
      configured = true;
    }
  },

  async generate(request: GenerateRequest): Promise<GeneratedImage> {
    this.assertConfigured();

    const endpoint = FAL_MODELS[request.model];
    const prompt = request.negativePrompt
      ? `${request.prompt}. ${request.negativePrompt}`
      : request.prompt;

    try {
      const { data } = await fal.subscribe(endpoint, {
        input: {
          prompt,
          seed: request.seed,
          num_images: 1,
          ...request.params,
        },
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const image = ResponseSchema.parse(data).images[0]!;
      return {
        url: image.url,
        width: image.width,
        height: image.height,
        contentType: image.content_type,
        seedApplied: true,
      };
    } catch (error) {
      throw new ProviderError(describeFalError(error, endpoint), {
        retryable: error instanceof ApiError && (error.status === 429 || error.status >= 500),
      });
    }
  },
};

function describeFalError(error: unknown, endpoint: string): string {
  if (error instanceof ValidationError) {
    const fields = error.fieldErrors
      .map((info) => `${info.loc.filter((part) => part !== "body").join(".")}: ${info.msg}`)
      .join("; ");
    return `fal.ai rejected the request to ${endpoint} as invalid - ${fields || "no field detail returned"}.`;
  }

  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
      case 403:
        return `fal.ai rejected the credentials (${error.status}). Check FAL_KEY in .env - keys are managed at ${SIGNUP_URL}.`;
      case 402:
        return "fal.ai reports an exhausted balance (402). Add credit, or switch to the free provider with PALETTE_PROVIDER=together.";
      case 404:
        return `fal.ai has no endpoint '${endpoint}' (404). The model id may have been renamed or retired.`;
      case 429:
        return "fal.ai rate limit or quota exceeded (429). Wait a moment and retry, or generate fewer concepts at once.";
      default:
        if (error.status >= 500) {
          return `fal.ai had a server error on ${endpoint} (${error.status}). This is usually transient - retry.`;
        }
        return `fal.ai request to ${endpoint} failed with HTTP ${error.status}.`;
    }
  }

  if (error instanceof z.ZodError) {
    return `fal.ai returned an unexpected response shape from ${endpoint}: ${error.issues
      .map((issue) => `${issue.path.join(".")} ${issue.message}`)
      .join("; ")}`;
  }

  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return `The request to ${endpoint} exceeded ${REQUEST_TIMEOUT_MS / 1000}s and was aborted.`;
    }
    return `Request to ${endpoint} failed: ${error.message}`;
  }

  return `Request to ${endpoint} failed for an unknown reason.`;
}
