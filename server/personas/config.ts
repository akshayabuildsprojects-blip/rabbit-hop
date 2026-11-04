import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

import { BASE_URL, MODEL_ID } from "../llm.js";

export const META = { baseURL: BASE_URL, model: MODEL_ID };

export const DEFAULT_DATA_DIR = process.env.PERSONA_DATA_DIR || path.resolve(here, "../../data");

export class ConfigError extends Error {}

export function requireApiKey(): string {
  const key = process.env.MODEL_API_KEY;
  if (!key || !key.trim()) {
    throw new ConfigError(
      "MODEL_API_KEY is not set. Create a key at dev.meta.ai (API keys), then run:\n  export MODEL_API_KEY=your_key\nor put it in a .env file (see .env.example).",
    );
  }
  return key.trim();
}

// Research quality gates. A run that falls short is rejected instead of drafted.
export const RESEARCH_REQUIREMENTS = {
  minWebSearchCalls: 1,
  minUniqueSources: 4,
  minReportChars: 2500,
};
