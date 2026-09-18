import { z } from "zod";

import {
  ASPECT_DIMENSIONS,
  CLOUDFLARE_API_BASE,
  CLOUDFLARE_MAX_STEPS,
  CLOUDFLARE_MODELS,
  REQUEST_TIMEOUT_MS,
} from "../../constants.js";
import { ProviderError, type GenerateRequest, type GeneratedImage, type ImageProvider } from "./types.js";

const EnvelopeSchema = z.object({
  success: z.boolean().optional(),
  result: z.object({ image: z.string() }).optional(),
  errors: z.array(z.object({ code: z.number().optional(), message: z.string() })).optional(),
});

const SIGNUP_URL = "https://dash.cloudflare.com/profile/api-tokens";

/**
 * Which tiers actually accept a seed.
 *
 * Cloudflare's docs list `seed` for flux-1-schnell, but the live API rejects it
 * with "Additional or unevaluated properties '/seed' at '/' not allowed".
 * Verified against the running service, not the documentation.
 */
const SUPPORTS_SEED: Record<string, boolean> = { schnell: false, dev: true };

/**
 * Cloudflare Workers AI.
 *
 * The free allocation is 10,000 Neurons a day, which is roughly 173 images from
 * flux-1-schnell, resets daily and needs no deposit or card.
 *
 * Two shape differences from the other providers:
 *  - the image comes back as base64 in the JSON envelope, not as a hosted url,
 *    so `bytes` is returned and the caller writes it to the library
 *  - flux-1-schnell has a fixed output size and accepts only prompt/steps/seed,
 *    so a requested aspect ratio cannot be honoured and is reported as a warning
 *    instead of being silently dropped
 */
export const cloudflareProvider: ImageProvider = {
  id: "cloudflare",
  label: "Cloudflare Workers AI (FLUX)",
  credentialEnvVar: "CLOUDFLARE_API_TOKEN",
  signupUrl: SIGNUP_URL,

  assertConfigured(): void {
    const missing = [
      process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ? null : "CLOUDFLARE_ACCOUNT_ID",
      process.env.CLOUDFLARE_API_TOKEN?.trim() ? null : "CLOUDFLARE_API_TOKEN",
    ].filter(Boolean);

    if (missing.length > 0) {
      throw new ProviderError(
        `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set. Create a free ` +
          `Workers AI token at ${SIGNUP_URL} (template: "Workers AI"), find your account id on the ` +
          "Cloudflare dashboard home page, then add both to the server's .env file and restart.",
      );
    }
  },

  async generate(request: GenerateRequest): Promise<GeneratedImage> {
    this.assertConfigured();

    const modelId = CLOUDFLARE_MODELS[request.model];
    const url = `${CLOUDFLARE_API_BASE}/${process.env.CLOUDFLARE_ACCOUNT_ID!.trim()}/ai/run/${modelId}`;
    const warnings: string[] = [];

    // Workers AI has no negative_prompt field, and exclusions must NOT be folded
    // into the positive prompt: diffusion models handle negation poorly, so
    // "no gradients" reliably produces gradients. Dropping them is strictly better.
    const prompt = request.prompt;

    const body: Record<string, unknown> = {
      prompt: prompt.slice(0, 2048),
      steps: Math.min(request.params.num_inference_steps, CLOUDFLARE_MAX_STEPS),
    };

    if (SUPPORTS_SEED[request.model]) {
      body.seed = request.seed;
    } else {
      warnings.push(
        `${modelId} does not accept a seed, so seed ${request.seed} was not applied. Icons in a set ` +
          "are still locked by style, palette and parameters, but they do not share initial noise.",
      );
    }

    if (request.model === "dev") {
      // flux-2-dev accepts dimensions and guidance; flux-1-schnell accepts neither.
      const { width, height } = ASPECT_DIMENSIONS[request.params.image_size];
      body.width = width;
      body.height = height;
      if (request.params.guidance_scale !== undefined) body.guidance = request.params.guidance_scale;
    } else if (request.params.image_size !== "square_hd") {
      warnings.push(
        `flux-1-schnell has a fixed output size, so aspect_ratio '${request.params.image_size}' was not applied. ` +
          "Use model 'dev' for explicit dimensions.",
      );
    }

    if (request.params.num_inference_steps > CLOUDFLARE_MAX_STEPS) {
      warnings.push(
        `Workers AI caps steps at ${CLOUDFLARE_MAX_STEPS}; ${request.params.num_inference_steps} was reduced.`,
      );
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN!.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new ProviderError(
          `Cloudflare Workers AI did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`,
          { retryable: true },
        );
      }
      throw new ProviderError(
        `Could not reach Cloudflare Workers AI: ${error instanceof Error ? error.message : String(error)}`,
        { retryable: true },
      );
    }

    const raw = await response.text();

    if (!response.ok) {
      throw new ProviderError(describeHttpError(response.status, raw, modelId), {
        retryable: response.status === 429 || response.status >= 500,
      });
    }

    // Some models stream raw image bytes back instead of the JSON envelope.
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.startsWith("image/")) {
      return {
        bytes: Buffer.from(raw, "binary"),
        contentType,
        warnings,
        seedApplied: SUPPORTS_SEED[request.model] ?? false,
      };
    }

    let envelope: z.infer<typeof EnvelopeSchema>;
    try {
      envelope = EnvelopeSchema.parse(JSON.parse(raw));
    } catch {
      throw new ProviderError(
        `Cloudflare Workers AI returned an unreadable response from ${modelId}: ${raw.slice(0, 200)}`,
      );
    }

    if (envelope.success === false || !envelope.result?.image) {
      const detail = envelope.errors?.map((error) => error.message).join("; ") ?? "no detail returned";
      throw new ProviderError(`Cloudflare Workers AI could not generate the image - ${detail}`, {
        retryable: /rate|limit|capacity|busy/i.test(detail),
      });
    }

    return {
      bytes: Buffer.from(envelope.result.image, "base64"),
      contentType: "image/jpeg",
      warnings,
      seedApplied: SUPPORTS_SEED[request.model] ?? false,
    };
  },
};

function describeHttpError(status: number, raw: string, modelId: string): string {
  const detail = extractMessage(raw);

  switch (status) {
    case 400:
      return `Cloudflare Workers AI rejected the request to ${modelId} (400).${detail ? ` ${detail}` : ""}`;
    case 401:
    case 403:
      return (
        `Cloudflare Workers AI rejected the credentials (${status}). Check CLOUDFLARE_API_TOKEN has the ` +
        `"Workers AI" permission and that CLOUDFLARE_ACCOUNT_ID is the account the token belongs to. ` +
        `Tokens are managed at ${SIGNUP_URL}.`
      );
    case 404:
      return (
        `Cloudflare Workers AI returned 404 for ${modelId}. Either CLOUDFLARE_ACCOUNT_ID is wrong or ` +
        "that model is not available on your account."
      );
    case 429:
      return (
        "Cloudflare Workers AI daily free allocation or rate limit reached (429). The 10,000 Neuron " +
        "free tier resets daily - wait, or generate fewer images at once."
      );
    default:
      if (status >= 500) {
        return `Cloudflare Workers AI had a server error on ${modelId} (${status}). Usually transient - retry.`;
      }
      return `Cloudflare Workers AI request to ${modelId} failed (${status}).${detail ? ` ${detail}` : ""}`;
  }
}

function extractMessage(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    const errors = (parsed as { errors?: Array<{ message?: string }> }).errors;
    if (Array.isArray(errors) && errors.length > 0) {
      return errors.map((error) => error.message).filter(Boolean).join("; ").slice(0, 300);
    }
  } catch {
    /* fall through to the raw text */
  }
  return raw.slice(0, 200);
}
