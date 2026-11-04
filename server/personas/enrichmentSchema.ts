import { z } from "zod";

// Retailer-contextualized behavior, layered on top of the core persona.
// Every claim is tagged with where it comes from, so evidence, retailer findings,
// inferred rules and hypothetical examples are never confused.
export const EVIDENCE_TYPES = ["research_supported", "retailer_specific", "inferred_rule", "hypothetical_example"] as const;

export const EvidenceRefSchema = z
  .object({
    type: z.enum(EVIDENCE_TYPES),
    source_url: z.string().url().nullable(), // a URL cited during research, or null for inferences/assumptions
    note: z.string().min(3),
  })
  .strict();

export const RETAILERS = ["sephora", "ulta"] as const;
export type RetailerId = (typeof RETAILERS)[number];

export const ParameterContextSchema = z
  .object({
    score: z.number().min(0).max(1),
    band: z.enum(["low", "medium", "high"]),
    definition: z.string().min(10),
    interpretation: z.string().min(10),
    rationale: z.string().min(10),
    shopping_manifestation: z.string().min(10),
    observable_actions: z.array(z.string().min(3)).min(2),
    retailer_examples: z.record(z.enum(RETAILERS), z.string().min(10)),
    evidence: z.array(EvidenceRefSchema).min(1),
  })
  .strict();

export const DECISION_SCENARIOS = [
  { id: "viral_mixed_reviews", label: "A viral product with mixed reviews" },
  { id: "popular_price_premium", label: "A popular product with a significant price premium" },
  { id: "similar_different_prices", label: "Two similar products with different prices" },
  { id: "familiar_vs_trending_brand", label: "A familiar brand versus an unfamiliar trending brand" },
  { id: "influencer_vs_weak_reviews", label: "A product with strong influencer endorsements but weak customer reviews" },
  { id: "new_limited_reviews", label: "A new product with limited reviews" },
  { id: "discounted_alternative", label: "A discounted alternative to a desired product" },
] as const;

export const ShoppingDecisionRuleSchema = z
  .object({
    scenario_id: z.enum(DECISION_SCENARIOS.map((s) => s.id) as [string, ...string[]]),
    investigate_first: z.string().min(5),
    information_sought: z.array(z.string().min(3)).min(1),
    conflict_weighing: z.string().min(10),
    purchase_triggers: z.array(z.string().min(3)).min(1),
    rejection_triggers: z.array(z.string().min(3)).min(1),
    influencing_parameters: z.array(z.string()).min(1),
    evidence: z.array(EvidenceRefSchema).min(1),
  })
  .strict();

export const SiteFeatureSchema = z
  .object({
    feature: z.string().min(3),
    relevance: z.string().min(5),
    verified: z.boolean(), // true only when a source cited during retailer research documents it
    source_url: z.string().url().nullable(),
  })
  .strict();

export const RetailerBehaviorSchema = z
  .object({
    display_name: z.string(),
    discovery: z.array(z.string().min(5)).min(1),
    browsing: z.array(z.string().min(5)).min(1),
    comparison: z.array(z.string().min(5)).min(1),
    purchase: z.array(z.string().min(5)).min(1),
    relevant_site_features: z.array(SiteFeatureSchema),
    differences_from_other_retailers: z.string(),
    evidence: z.array(EvidenceRefSchema).min(1),
  })
  .strict();

export const ListingSchema = z
  .object({
    label: z.string(), // e.g. "Product A"
    description: z.string(),
    price_usd: z.number().positive(),
    popularity: z.string(),
    brand_reputation: z.string(),
    social_influence: z.string(),
    customer_reviews: z.string(),
    performance_claims: z.string(),
    novelty: z.string(),
  })
  .strict();

export const BehavioralScenarioSchema = z
  .object({
    scenario_id: z.string().regex(/^[a-z0-9_-]{2,40}$/),
    title: z.string().min(5),
    retailer_setting: z.enum(RETAILERS),
    listings: z.array(ListingSchema).min(2),
    expected_journey: z.array(z.string().min(5)).min(3),
    parameter_influence: z.array(z.object({ parameter: z.string(), effect: z.string().min(5) }).strict()).min(1),
    plausible_outcomes: z.array(z.object({ outcome: z.string().min(3), conditions: z.string().min(5) }).strict()).min(2),
    evidence_type: z.literal("hypothetical_example"),
  })
  .strict();

export const ObservableActionsSchema = z
  .object({
    discovery: z.array(z.string().min(5)).min(2),
    browsing: z.array(z.string().min(5)).min(2),
    comparison: z.array(z.string().min(5)).min(2),
    purchase: z.array(z.string().min(5)).min(2),
    rejection_or_substitution: z.array(z.string().min(5)).min(1),
  })
  .strict();

export const RetailerResearchRefSchema = z
  .object({
    report_path: z.string(),
    response_id: z.string(),
    research_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    web_search_calls: z.number().int().nonnegative(),
    sources: z.array(z.object({ url: z.string(), title: z.string() }).strict()),
    enriched_at: z.string(),
  })
  .strict();
