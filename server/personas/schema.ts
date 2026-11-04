import { z } from "zod";
import {
  BehavioralScenarioSchema,
  DECISION_SCENARIOS,
  ObservableActionsSchema,
  ParameterContextSchema,
  RetailerBehaviorSchema,
  RetailerResearchRefSchema,
  RETAILERS,
  ShoppingDecisionRuleSchema,
} from "./enrichmentSchema.js";

// Persona ids: lowercase slug. Used as file names, so keep this strict.
export const PersonaIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,39}$/, "Persona id must be a lowercase slug like 'trend-driven' (letters, digits, hyphens).");

export const PersonaDefinitionSchema = z
  .object({
    persona_id: PersonaIdSchema,
    order: z.number().int().positive(),
    persona_name: z.string().min(3),
    initial_description: z.string().min(10),
    // Baseline behavioral hypotheses. Research substantiates, challenges and refines them.
    baseline: z
      .object({
        motivation: z.string().min(5),
        characteristics: z.array(z.string().min(3)).min(1),
        shopping_journey: z.array(z.string().min(2)).min(2),
        // Optional plain-text context for research (focus areas, guardrails, score hypotheses,
        // situations to cover). Same field for every persona; only the content differs.
        research_notes: z.string().max(8000).optional(),
      })
      .strict(),
    ui_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    note: z.string().optional(),
  })
  .strict();
export type PersonaDefinition = z.infer<typeof PersonaDefinitionSchema>;

// Numbered hypotheses (H1, H2, ...) used in research prompts and the baseline assessment.
export function baselineHypotheses(def: PersonaDefinition): string[] {
  return [
    `Motivation: ${def.baseline.motivation}`,
    ...def.baseline.characteristics,
    `Shopping journey: ${def.baseline.shopping_journey.join(" → ")}`,
  ];
}

export const notesBlock = (def: PersonaDefinition, heading = "Persona-specific research notes (context to guide this persona's research; not a required output format)") =>
  def.baseline.research_notes?.trim() ? `\n${heading}:\n"""\n${def.baseline.research_notes.trim()}\n"""\n` : "";

export const VERDICTS = ["supported", "refined", "challenged", "insufficient_evidence"] as const;

const Score = z.number().min(0, "Scores must be between 0 and 1.").max(1, "Scores must be between 0 and 1.");

export const BEHAVIOR_KEYS = [
  "trend_sensitivity",
  "influencer_trust",
  "price_sensitivity",
  "brand_loyalty",
  "research_depth",
  "novelty_seeking",
  "impulse_buying_tendency",
  "product_quality_priority",
  "convenience_priority",
  "prestige_priority",
] as const;

export const BEHAVIOR_NOTE =
  "Simulation settings informed by qualitative research. Not scientifically validated population measurements.";

export const BehavioralParametersSchema = z
  .object({
    note: z.literal(BEHAVIOR_NOTE),
    trend_sensitivity: Score,
    influencer_trust: Score,
    price_sensitivity: Score,
    brand_loyalty: Score,
    research_depth: Score,
    novelty_seeking: Score,
    impulse_buying_tendency: Score,
    product_quality_priority: Score,
    convenience_priority: Score,
    prestige_priority: Score,
  })
  .strict();

const NonEmptyList = z.array(z.string().min(3)).min(1);

export const ShoppingBehaviorSchema = z
  .object({
    preferred_discovery_channels: NonEmptyList,
    trusted_information_sources: NonEmptyList,
    product_evaluation_criteria: NonEmptyList,
    purchase_triggers: NonEmptyList,
    rejection_criteria: NonEmptyList,
    comparison_strategy: z.string().min(10),
    typical_shopping_sequence: z.array(z.string().min(3)).min(3),
  })
  .strict();

export const DecisionRuleSchema = z
  .object({
    rule: z.string().min(10),
    rationale: z.string().min(5),
    basis: z.enum(["research_supported", "modeling_assumption"]),
  })
  .strict();

export const SourceSchema = z
  .object({
    url: z.string().url(),
    title: z.string(),
    published_date: z.string().nullable(), // as stated in the source or report; null when unknown
    used_for: z.string(),
  })
  .strict();

export const BaselineAssessmentSchema = z
  .object({
    hypothesis: z.string().min(3),
    verdict: z.enum(VERDICTS),
    note: z.string().min(3),
  })
  .strict();

export const ResearchEvidenceSchema = z
  .object({
    baseline_assessment: z.array(BaselineAssessmentSchema).min(1, "Every profile must record how research judged the baseline hypotheses."),
    supporting_sources: z.array(SourceSchema).min(1, "A persona needs at least one verifiable supporting source."),
    evidence_summary: z.string().min(20),
    research_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    research_report_path: z.string(),
    research_response_id: z.string(),
    assumptions: z.array(z.string()),
    limitations: z.array(z.string()).min(1),
    retailer_research: RetailerResearchRefSchema.optional(),
    // The baseline the research tested, so the UI can tell when the baseline has since changed.
    baseline_snapshot: z
      .object({ motivation: z.string(), characteristics: z.array(z.string()), shopping_journey: z.array(z.string()), research_notes: z.string().optional() })
      .strict()
      .optional(),
  })
  .strict();

export const MetadataSchema = z
  .object({
    status: z.enum(["draft", "locked"]),
    version: z.number().int().positive(),
    model: z.string(),
    generated_at: z.string(),
    edited_at: z.string().nullable(),
    approved_at: z.string().nullable(),
    content_hash: z.string().nullable(),
  })
  .strict();

// .strict() everywhere means context fields (age, income, budget, location, retailer...)
// cannot sneak into a persona. They belong in session_config.
export const PersonaProfileSchema = z
  .object({
    schema_version: z.literal(1),
    persona_id: PersonaIdSchema,
    persona_name: z.string().min(3),
    description: z.string().min(20),
    primary_motivation: z.string().min(10),
    behavioral_parameters: BehavioralParametersSchema,
    shopping_behavior: ShoppingBehaviorSchema,
    decision_rules: z.array(DecisionRuleSchema).min(3),
    // Contextualized behavior (optional so profiles from before enrichment still load).
    parameter_context: z.record(z.enum(BEHAVIOR_KEYS), ParameterContextSchema).optional(),
    shopping_decision_rules: z.array(ShoppingDecisionRuleSchema).optional(),
    expected_observable_actions: ObservableActionsSchema.optional(),
    behavioral_scenarios: z.array(BehavioralScenarioSchema).optional(),
    // Retailer layer: keyed by retailer so the same psychology can be tested elsewhere later.
    retailer_behavior: z.record(z.enum(RETAILERS), RetailerBehaviorSchema).optional(),
    research_evidence: ResearchEvidenceSchema,
    metadata: MetadataSchema,
  })
  .strict()
  .superRefine((p, ctx) => {
    const pc = p.parameter_context;
    if (pc) {
      for (const k of BEHAVIOR_KEYS) {
        if (!pc[k]) ctx.addIssue({ code: "custom", path: ["parameter_context", k], message: "Missing context for this parameter." });
        else if (Math.abs(pc[k].score - p.behavioral_parameters[k]) > 1e-9)
          ctx.addIssue({ code: "custom", path: ["parameter_context", k, "score"], message: "Context score must equal the behavioral parameter score." });
      }
    }
    const rules = p.shopping_decision_rules;
    if (rules) {
      const ids = new Set(rules.map((r) => r.scenario_id));
      for (const s of DECISION_SCENARIOS) if (!ids.has(s.id)) ctx.addIssue({ code: "custom", path: ["shopping_decision_rules"], message: `Missing decision rule for '${s.id}'.` });
    }
    if (p.behavioral_scenarios && p.behavioral_scenarios.length < 5) ctx.addIssue({ code: "custom", path: ["behavioral_scenarios"], message: "At least five behavioral scenarios are required." });
    if (p.retailer_behavior) for (const r of RETAILERS) if (!p.retailer_behavior[r]) ctx.addIssue({ code: "custom", path: ["retailer_behavior", r], message: "Missing retailer behavior." });
  });

export type PersonaProfile = z.infer<typeof PersonaProfileSchema>;

export const LockedPersonaSchema = PersonaProfileSchema.refine(
  (p) => p.metadata.status === "locked" && Boolean(p.metadata.approved_at) && /^sha256:[a-f0-9]{64}$/.test(p.metadata.content_hash ?? ""),
  { message: "A locked profile needs status 'locked', an approval time and a sha256 content hash." },
);

export function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
}
