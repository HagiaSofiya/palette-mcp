import { z } from "zod";

import {
  ASPECT_DIMENSIONS,
  REQUEST_TIMEOUT_MS,
  TOGETHER_API_URL,
  TOGETHER_MODELS,
} from "../../constants.js";
import { ProviderError, type GenerateRequest, type GeneratedImage, type ImageProvider } from "./types.js";

const ResponseSchema = z.object({
  data: z
    .array(
      z.object({
        url: z.url().optional(),
        b64_json: z.string().optional(),
      }),
    )
    .min(1),
});

const SIGNUP_URL = "https://api.together.ai/settings/api-keys";

/**
 * Together AI, via the OpenAI-shaped /v1/images/generations endpoint.
 *
 * The 'schnell' tier maps to FLUX.1-schnell-Free, which bills nothing. 'dev'
 * maps to FLUX.1-dev, which needs a funded account - the 402/403 that comes
 * back in that case is translated into a message that says so.
 */
export const togetherProvider: ImageProvider = {
  id: "together",
  label: "Together AI (FLUX.1)",
  credentialEnvVar: "TOGETHER_API_KEY",
  signupUrl: SIGNUP_URL,

  assertConfigured(): void {
    if (!process.env.TOGETHER_API_KEY?.trim()) {
      throw new ProviderError(
        `TOGETHER_API_KEY is not set. Create a free key at ${SIGNUP_URL}, then put ` +
          "TOGETHER_API_KEY=<key> in the server's .env file and restart.",
      );
    }
  },

  async generate(request: GenerateRequest): Promise<GeneratedImage> {
    this.assertConfigured();

    const { width, height } = ASPECT_DIMENSIONS[request.params.image_size];
    const body: Record<string, unknown> = {
      model: TOGETHER_MODELS[request.model],
      prompt: request.prompt,
      width,
      height,
      steps: request.params.num_inference_steps,
      n: 1,
      seed: request.seed,
      response_format: "url",
      output_format: request.params.output_format,
    };

    // Together exposes negative_prompt as a real parameter, so style exclusions
    // stay out of the positive prompt where they would compete for attention.
    if (request.negativePrompt) body.negative_prompt = request.negativePrompt;
    if (request.params.guidance_scale !== undefined) {
      body.guidance_scale = request.params.guidance_scale;
    }

    let response: Response;
    try {
      response = await fetch(TOGETHER_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.TOGETHER_API_KEY!.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new ProviderError(
          `Together AI did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`,
          { retryable: true },
        );
      }
      throw new ProviderError(
        `Could not reach Together AI: ${error instanceof Error ? error.message : String(error)}`,
        { retryable: true },
      );
    }

    if (!response.ok) {
      throw new ProviderError(await describeHttpError(response, request), {
        retryable: response.status === 429 || response.status >= 500,
      });
    }

    const parsed = ResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ProviderError(
        `Together AI returned an unexpected response shape: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      );
    }

    const first = parsed.data.data[0]!;
    if (!first.url) {
      throw new ProviderError("Together AI returned an image without a url.");
    }

    return {
      url: first.url,
      width,
      height,
      contentType: request.params.output_format === "png" ? "image/png" : "image/jpeg",
      seedApplied: true,
    };
  },
};

/** Never echoes the API key, and explains the free-vs-paid model distinction. */
async function describeHttpError(response: Response, request: GenerateRequest): Promise<string> {
  const detail = await readErrorMessage(response);
  const modelId = TOGETHER_MODELS[request.model];

  switch (response.status) {
    case 401:
      return `Together AI rejected the credentials (401). Check TOGETHER_API_KEY in .env - create one at ${SIGNUP_URL}.`;
    case 402:
    case 403:
      if (request.model === "dev") {
        return (
          `Together AI refused '${modelId}' (${response.status}). The 'dev' tier is a paid model. ` +
          "Use model 'schnell' instead - it maps to FLUX.1-schnell-Free, which costs nothing." +
          (detail ? ` Provider said: ${detail}` : "")
        );
      }
      return `Together AI refused the request (${response.status}).${detail ? ` ${detail}` : ""}`;
    case 429:
      return (
        "Together AI rate limit hit (429). The free tier allows roughly 10 image requests a minute. " +
        "Wait a moment and retry, or generate fewer concepts at once."
      );
    case 404:
      return `Together AI has no model '${modelId}' (404). It may have been renamed or retired.`;
    default:
      if (response.status >= 500) {
        return `Together AI had a server error (${response.status}). This is usually transient - retry.`;
      }
      return `Together AI request failed (${response.status}).${detail ? ` ${detail}` : ""}`;
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return "";
    try {
      const parsed: unknown = JSON.parse(text);
      const message = (parsed as { error?: { message?: string }; message?: string })?.error?.message
        ?? (parsed as { message?: string })?.message;
      return typeof message === "string" ? message.slice(0, 300) : text.slice(0, 300);
    } catch {
      return text.slice(0, 300);
    }
  } catch {
    return "";
  }
}
