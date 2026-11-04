import OpenAI from "openai";
import { META, requireApiKey } from "./config.js";

// The subset of the Responses API object this project reads.
export interface ResponseLike {
  id: string;
  model?: string;
  status?: string;
  output: Array<Record<string, any>>;
  usage?: Record<string, unknown> | null;
}

export interface MetaClient {
  createResponse(params: Record<string, unknown>): Promise<ResponseLike>;
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string | null,
    public param?: string | null,
  ) {
    super(message);
  }
}

const RETRYABLE = new Set([429, 500, 503]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Turns SDK / HTTP errors into messages that say what to do. Never includes the key.
export function toMetaApiError(err: any): MetaApiError {
  if (err instanceof MetaApiError) return err;
  const status: number | undefined = err?.status;
  const body = err?.error ?? {};
  const code = body?.code ?? err?.code ?? null;
  const param = body?.param ?? null;
  const detail = String(body?.message ?? err?.message ?? "Unknown error").replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  const hint: Record<number, string> = {
    400: "The request was rejected as invalid. Check the parameter named below; the API docs list supported fields.",
    401: "Authentication failed. Check that MODEL_API_KEY is correct and not revoked.",
    402: "Billing problem on the Meta Model API account. Check credits and the payment method on the Billing page.",
    403: "This key is not allowed to use the requested model or tool.",
    404: "Model or endpoint not found. Check PERSONA_MODEL_ID and MODEL_API_BASE_URL.",
    429: "Rate limited by Meta Model API after retries. Wait a minute and run again.",
    504: "The request timed out at Meta's gateway.",
  };
  const prefix = status ? `Meta Model API error ${status}${code ? ` (${code})` : ""}` : "Could not reach Meta Model API";
  const help = status ? (hint[status] ?? (status >= 500 ? "Meta's service had a problem. Try again shortly." : "")) : "Check your network connection.";
  return new MetaApiError(`${prefix}: ${detail}${param ? ` [param: ${param}]` : ""}\n${help}`.trim(), status, code, param);
}

export async function withRetries<T>(fn: () => Promise<T>, attempts = 4, baseMs = 800): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      last = err;
      const status = err?.status;
      if (!RETRYABLE.has(status) || i === attempts - 1) break;
      const retryAfter = Number(err?.headers?.get?.("retry-after") ?? err?.headers?.["retry-after"]);
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : baseMs * 2 ** i + Math.random() * 1000;
      await sleep(wait);
    }
  }
  throw toMetaApiError(last);
}

// Real client. Uses streaming so long web-research turns do not hit the 504 gateway timeout
// that applies to non-streaming requests (see dev.meta.ai/docs/error-handling).
export function createMetaClient(): MetaClient {
  const client = new OpenAI({ baseURL: META.baseURL, apiKey: requireApiKey() });
  return {
    async createResponse(params) {
      return withRetries(async () => {
        const stream = client.responses.stream(params as any);
        const final = await stream.finalResponse();
        return final as unknown as ResponseLike;
      });
    },
  };
}

// Helpers to read a Responses API object.
export function outputText(res: ResponseLike): string {
  return res.output
    .filter((o) => o.type === "message")
    .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((c: any) => c.type === "output_text")
    .map((c: any) => c.text ?? "")
    .join("\n\n")
    .trim();
}
