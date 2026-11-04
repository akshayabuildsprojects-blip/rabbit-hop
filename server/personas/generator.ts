import { META } from "./config.js";
import { BEHAVIOR_KEYS, BEHAVIOR_NOTE, VERDICTS, baselineHypotheses, notesBlock, formatZodError, PersonaProfileSchema, type PersonaDefinition, type PersonaProfile } from "./schema.js";
import type { ResearchResult } from "./researchSchema.js";
import { CONTEXT_KEYS } from "./context.js";
import { MetaApiError, outputText, type MetaClient } from "./metaClient.js";
import { generationInstructions } from "./prompts.js";

export class PersonaValidationError extends Error {}

const str = { type: "string" };
const strList = { type: "array", items: str };

// JSON Schema the model fills. Follows the strict-mode rules in dev.meta.ai/docs/structured-output:
// plain object root, additionalProperties false everywhere, every property required.
export const GENERATED_PROFILE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["description", "primary_motivation", "behavioral_parameters", "shopping_behavior", "decision_rules", "baseline_assessment", "evidence_summary", "supporting_sources", "assumptions", "limitations"],
  properties: {
    description: { type: "string", description: "2 to 4 sentences describing shopping behavior only" },
    primary_motivation: str,
    behavioral_parameters: {
      type: "object",
      additionalProperties: false,
      required: [...BEHAVIOR_KEYS],
      properties: Object.fromEntries(BEHAVIOR_KEYS.map((k) => [k, { type: "number", description: "0 to 1" }])),
    },
    shopping_behavior: {
      type: "object",
      additionalProperties: false,
      required: ["preferred_discovery_channels", "trusted_information_sources", "product_evaluation_criteria", "purchase_triggers", "rejection_criteria", "comparison_strategy", "typical_shopping_sequence"],
      properties: {
        preferred_discovery_channels: strList,
        trusted_information_sources: strList,
        product_evaluation_criteria: strList,
        purchase_triggers: strList,
        rejection_criteria: strList,
        comparison_strategy: str,
        typical_shopping_sequence: { type: "array", items: str, description: "Ordered steps" },
      },
    },
    decision_rules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rule", "rationale", "basis"],
        properties: { rule: str, rationale: str, basis: { type: "string", enum: ["research_supported", "modeling_assumption"] } },
      },
    },
    baseline_assessment: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["hypothesis", "verdict", "note"],
        properties: { hypothesis: str, verdict: { type: "string", enum: [...VERDICTS] }, note: str },
      },
    },
    evidence_summary: str,
    supporting_sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["url", "published_date", "used_for"],
        properties: { url: str, published_date: { type: "string", description: "As stated in the report, or 'unknown'" }, used_for: str },
      },
    },
    assumptions: strList,
    limitations: strList,
  },
};

function generationInput(def: PersonaDefinition, r: ResearchResult, all: PersonaDefinition[] = [], peerScores = "") {
  const others = all.filter((d) => d.persona_id !== def.persona_id);
  return `Persona id: ${def.persona_id}
Persona name: ${def.persona_name}
Summary: ${def.initial_description}

Baseline hypotheses:
${baselineHypotheses(def).map((h, i) => `H${i + 1}. ${h}`).join("\n")}
${others.length ? `\nOther archetypes in the simulation (stay distinct from them):\n${others.map((d) => `- ${d.persona_name}: ${d.baseline.motivation}`).join("\n")}\n` : ""}${peerScores ? `\nScores already researched for other archetypes (for distinctness, not to copy):\n${peerScores}\n` : ""}${notesBlock(def)}
Allowed source URLs (cited during research; use only these, exactly as written):
${r.sources.map((s) => `- ${s.url} | ${s.title}`).join("\n")}

Research report (performed ${r.research_date}):
"""
${r.report_text}
"""`;
}

export function buildGenerationRequest(def: PersonaDefinition, r: ResearchResult, structured = true, all: PersonaDefinition[] = [], peerScores = "") {
  const base = {
    model: META.model,
    instructions: generationInstructions() + (structured ? "" : `\n\nReturn ONLY a JSON object matching this JSON Schema, no prose:\n${JSON.stringify(GENERATED_PROFILE_JSON_SCHEMA)}`),
    input: generationInput(def, r, all, peerScores),
    reasoning: { effort: "medium" },
    store: false,
  };
  return structured ? { ...base, text: { format: { type: "json_schema", name: "persona_profile", schema: GENERATED_PROFILE_JSON_SCHEMA, strict: true } } } : base;
}

export function parseJsonOutput(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new PersonaValidationError("The model did not return a JSON object for the persona profile.");
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (e: any) {
    throw new PersonaValidationError(`The persona profile JSON could not be parsed: ${e.message}`);
  }
}

// Finds context fields (age, budget, location...) anywhere in an object.
export function findContextKeys(value: unknown, trail = ""): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((v, i) => findContextKeys(v, `${trail}[${i}]`));
  return Object.entries(value).flatMap(([k, v]) => [...(CONTEXT_KEYS.includes(k) ? [`${trail}${trail ? "." : ""}${k}`] : []), ...findContextKeys(v, `${trail}${trail ? "." : ""}${k}`)]);
}

export function validateProfile(candidate: unknown): PersonaProfile {
  const ctx = findContextKeys(candidate);
  if (ctx.length) throw new PersonaValidationError(`Persona profiles must not contain consumer-context fields (put them in session_config): ${ctx.join(", ")}`);
  const parsed = PersonaProfileSchema.safeParse(candidate);
  if (!parsed.success) throw new PersonaValidationError(`Persona profile failed schema validation:\n${formatZodError(parsed.error)}`);
  return parsed.data;
}

// Assembles the full profile: model-generated behavior + evidence metadata taken from the
// research run itself (date, response id, cited titles), never from the model's memory.
type GenOpts = { reportPath: string; version: number; now?: Date; all?: PersonaDefinition[]; peerScores?: string };

export function assembleProfile(def: PersonaDefinition, r: ResearchResult, generated: any, opts: GenOpts): PersonaProfile {
  const now = opts.now ?? new Date();
  const titleByUrl = new Map(r.sources.map((s) => [s.url, s.title]));
  const rawSources: any[] = Array.isArray(generated?.supporting_sources) ? generated.supporting_sources : [];
  const verified = rawSources.filter((s) => titleByUrl.has(s?.url));
  const dropped = rawSources.length - verified.length;
  const seen = new Set<string>();
  const sources = verified
    .filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)))
    .map((s) => ({
      url: s.url,
      title: titleByUrl.get(s.url) || s.url,
      published_date: s.published_date && s.published_date !== "unknown" ? String(s.published_date) : null,
      used_for: String(s.used_for ?? ""),
    }));
  const limitations: string[] = [...(Array.isArray(generated?.limitations) ? generated.limitations : [])];
  if (dropped > 0) limitations.push(`${dropped} source URL(s) proposed by the model were removed because they were not among the sources cited during web research.`);
  if (!limitations.some((l) => /not .*validated|not .*population/i.test(l))) limitations.push(BEHAVIOR_NOTE);

  return validateProfile({
    schema_version: 1,
    persona_id: def.persona_id,
    persona_name: def.persona_name, // identity comes from the registry, not the model
    description: generated?.description,
    primary_motivation: generated?.primary_motivation,
    behavioral_parameters: { note: BEHAVIOR_NOTE, ...(generated?.behavioral_parameters ?? {}) },
    shopping_behavior: generated?.shopping_behavior,
    decision_rules: generated?.decision_rules,
    research_evidence: {
      baseline_assessment: Array.isArray(generated?.baseline_assessment) ? generated.baseline_assessment : [],
      baseline_snapshot: structuredClone(def.baseline),
      supporting_sources: sources,
      evidence_summary: generated?.evidence_summary,
      research_date: r.research_date,
      research_report_path: opts.reportPath,
      research_response_id: r.response_id,
      assumptions: Array.isArray(generated?.assumptions) ? generated.assumptions : [],
      limitations,
    },
    metadata: { status: "draft", version: opts.version, model: r.model, generated_at: now.toISOString(), edited_at: null, approved_at: null, content_hash: null },
  });
}

export async function generateProfile(client: MetaClient, def: PersonaDefinition, r: ResearchResult, opts: GenOpts): Promise<PersonaProfile> {
  let res;
  try {
    res = await client.createResponse(buildGenerationRequest(def, r, true, opts.all, opts.peerScores));
  } catch (err) {
    // If structured output is rejected for this endpoint, fall back to prompt-constrained JSON.
    // Zod validation below still enforces the schema either way.
    if (err instanceof MetaApiError && err.status === 400 && /text|format|schema/i.test(`${err.param} ${err.message}`)) {
      res = await client.createResponse(buildGenerationRequest(def, r, false, opts.all, opts.peerScores));
    } else throw err;
  }
  return assembleProfile(def, r, parseJsonOutput(outputText(res)), opts);
}
