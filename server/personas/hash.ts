import { createHash } from "node:crypto";
import type { PersonaProfile } from "./schema.js";

// Deterministic JSON: object keys sorted at every level.
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as any)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// Hash covers everything that defines behavior and evidence, plus persona id and version.
// Status, timestamps and the hash itself are excluded.
export function contentHash(profile: PersonaProfile): string {
  const { metadata, ...content } = profile;
  const payload = stableStringify({ ...content, version: metadata.version, model: metadata.model });
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

export function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj as object)) deepFreeze(v);
  }
  return obj;
}
