import fs from "node:fs";
import path from "node:path";
import { PersonaValidationError } from "./generator.js";
import { formatZodError, PersonaDefinitionSchema, PersonaIdSchema, type PersonaDefinition } from "./schema.js";

export class UnknownPersonaError extends Error {}

// Persona definitions are plain JSON files in data/persona-definitions, so adding or
// editing an archetype needs no code change.
export function loadDefinitions(dataDir: string): PersonaDefinition[] {
  const dir = path.join(dataDir, "persona-definitions");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const parsed = PersonaDefinitionSchema.safeParse(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
      if (!parsed.success) throw new Error(`Invalid persona definition ${f}:\n${formatZodError(parsed.error)}`);
      if (`${parsed.data.persona_id}.json` !== f) throw new Error(`Persona definition ${f} must be named ${parsed.data.persona_id}.json`);
      return parsed.data;
    })
    .sort((a, b) => a.order - b.order);
}

export function getDefinition(dataDir: string, id: unknown): PersonaDefinition {
  const idCheck = PersonaIdSchema.safeParse(id);
  const defs = loadDefinitions(dataDir);
  const known = defs.map((d) => d.persona_id).join(", ") || "(none found)";
  if (!idCheck.success) throw new UnknownPersonaError(`Invalid persona id '${String(id)}'. Known personas: ${known}`);
  const def = defs.find((d) => d.persona_id === idCheck.data);
  if (!def) throw new UnknownPersonaError(`Unknown persona '${idCheck.data}'. Known personas: ${known}`);
  return def;
}

// Saves an edited baseline (the persona's input hypotheses). Findings are not touched; the
// UI offers Regenerate so new research tests the new baseline.
export function saveBaseline(dataDir: string, id: unknown, baseline: unknown): PersonaDefinition {
  const def = getDefinition(dataDir, id);
  const next = PersonaDefinitionSchema.safeParse({ ...def, baseline });
  if (!next.success) throw new PersonaValidationError(`The baseline is incomplete:\n${formatZodError(next.error)}`);
  fs.writeFileSync(path.join(dataDir, "persona-definitions", `${def.persona_id}.json`), JSON.stringify(next.data, null, 2) + "\n");
  return next.data;
}
