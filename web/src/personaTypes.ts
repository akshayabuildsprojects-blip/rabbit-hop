// Client-side mirror of server/personas/schema.ts (the server validates; this is for typing only).
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
export type BehaviorKey = (typeof BEHAVIOR_KEYS)[number];

export const BEHAVIOR_LABEL: Record<BehaviorKey, string> = {
  trend_sensitivity: "Trend sensitivity",
  influencer_trust: "Influencer trust",
  price_sensitivity: "Price sensitivity",
  brand_loyalty: "Brand loyalty",
  research_depth: "Research depth",
  novelty_seeking: "Novelty seeking",
  impulse_buying_tendency: "Impulse buying",
  product_quality_priority: "Quality priority",
  convenience_priority: "Convenience priority",
  prestige_priority: "Prestige priority",
};

export interface ShoppingBehavior {
  preferred_discovery_channels: string[];
  trusted_information_sources: string[];
  product_evaluation_criteria: string[];
  purchase_triggers: string[];
  rejection_criteria: string[];
  comparison_strategy: string;
  typical_shopping_sequence: string[];
}

export interface DecisionRule {
  rule: string;
  rationale: string;
  basis: "research_supported" | "modeling_assumption";
}

export type EvidenceType = "research_supported" | "retailer_specific" | "inferred_rule" | "hypothetical_example";
export interface EvidenceRef {
  type: EvidenceType;
  source_url: string | null;
  note: string;
}
export type RetailerId = "sephora" | "ulta";
export interface ParameterContext {
  score: number;
  band: "low" | "medium" | "high";
  definition: string;
  interpretation: string;
  rationale: string;
  shopping_manifestation: string;
  observable_actions: string[];
  retailer_examples: Record<RetailerId, string>;
  evidence: EvidenceRef[];
}
export interface ShoppingDecisionRule {
  scenario_id: string;
  investigate_first: string;
  information_sought: string[];
  conflict_weighing: string;
  purchase_triggers: string[];
  rejection_triggers: string[];
  influencing_parameters: string[];
  evidence: EvidenceRef[];
}
export interface RetailerBehavior {
  display_name: string;
  discovery: string[];
  browsing: string[];
  comparison: string[];
  purchase: string[];
  relevant_site_features: { feature: string; relevance: string; verified: boolean; source_url: string | null }[];
  differences_from_other_retailers: string;
  evidence: EvidenceRef[];
}
export interface BehavioralScenario {
  scenario_id: string;
  title: string;
  retailer_setting: RetailerId;
  listings: { label: string; description: string; price_usd: number; popularity: string; brand_reputation: string; social_influence: string; customer_reviews: string; performance_claims: string; novelty: string }[];
  expected_journey: string[];
  parameter_influence: { parameter: string; effect: string }[];
  plausible_outcomes: { outcome: string; conditions: string }[];
  evidence_type: "hypothetical_example";
}
export interface ObservableActions {
  discovery: string[];
  browsing: string[];
  comparison: string[];
  purchase: string[];
  rejection_or_substitution: string[];
}

export const DECISION_SCENARIO_LABELS: Record<string, string> = {
  viral_mixed_reviews: "A viral product with mixed reviews",
  popular_price_premium: "A popular product with a significant price premium",
  similar_different_prices: "Two similar products with different prices",
  familiar_vs_trending_brand: "A familiar brand versus an unfamiliar trending brand",
  influencer_vs_weak_reviews: "Strong influencer endorsements but weak customer reviews",
  new_limited_reviews: "A new product with limited reviews",
  discounted_alternative: "A discounted alternative to a desired product",
};

export interface PersonaProfile {
  schema_version: 1;
  persona_id: string;
  persona_name: string;
  description: string;
  primary_motivation: string;
  behavioral_parameters: { note: string } & Record<BehaviorKey, number>;
  shopping_behavior: ShoppingBehavior;
  decision_rules: DecisionRule[];
  parameter_context?: Record<BehaviorKey, ParameterContext>;
  shopping_decision_rules?: ShoppingDecisionRule[];
  expected_observable_actions?: ObservableActions;
  behavioral_scenarios?: BehavioralScenario[];
  retailer_behavior?: Record<RetailerId, RetailerBehavior>;
  research_evidence: {
    baseline_assessment: { hypothesis: string; verdict: "supported" | "refined" | "challenged" | "insufficient_evidence"; note: string }[];
    supporting_sources: { url: string; title: string; published_date: string | null; used_for: string }[];
    evidence_summary: string;
    research_date: string;
    research_report_path: string;
    research_response_id: string;
    assumptions: string[];
    limitations: string[];
    baseline_snapshot?: { motivation: string; characteristics: string[]; shopping_journey: string[]; research_notes?: string };
    retailer_research?: { report_path: string; response_id: string; research_date: string; web_search_calls: number; sources: { url: string; title: string }[]; enriched_at: string };
  };
  metadata: {
    status: "draft" | "locked";
    version: number;
    model: string;
    generated_at: string;
    edited_at: string | null;
    approved_at: string | null;
    content_hash: string | null;
  };
}

export interface ResearchResult {
  persona_id: string;
  research_date: string;
  performed_at: string;
  model: string;
  response_id: string;
  web_search_calls: number;
  report_text: string;
  annotations: { url: string; title: string; start_index?: number; end_index?: number }[];
  sources: { url: string; title: string }[];
  considered_results: { url: string; title?: string; snippet?: string }[];
}

export interface PersonaDetail {
  definition: { persona_id: string; persona_name: string; initial_description: string; baseline: { motivation: string; characteristics: string[]; shopping_journey: string[]; research_notes?: string }; ui_color?: string };
  status: "not researched" | "draft" | "locked" | "locked + new draft";
  draft: PersonaProfile | null;
  locked: PersonaProfile | null;
  research: ResearchResult | null;
  retailerResearch?: ResearchResult | null;
  baselineChanged: boolean;
}
