import OpenAI from "openai";

// Meta Model API is OpenAI-compatible: base URL https://api.meta.ai/v1, Bearer MODEL_API_KEY.
export const MODEL_ID = process.env.MODEL_ID || "muse-spark-1.3";
export const BASE_URL = process.env.MODEL_API_BASE_URL || "https://api.meta.ai/v1";
export const HAS_KEY = Boolean(process.env.MODEL_API_KEY);

let client: OpenAI | null = null;
export function llm(): OpenAI {
  if (!client) client = new OpenAI({ baseURL: BASE_URL, apiKey: process.env.MODEL_API_KEY });
  return client;
}

export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("Model did not return JSON");
  return JSON.parse(raw.slice(start, end + 1)) as T;
}
