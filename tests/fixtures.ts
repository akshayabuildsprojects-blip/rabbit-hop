// Mock Meta Model API responses. These are TEST FIXTURES with placeholder URLs on
// example.org; they are not research output and are never written to data/.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MetaClient, ResponseLike } from "../server/personas/metaClient.js";
import { RESEARCH_SECTIONS } from "../server/personas/prompts.js";

export const SOURCES = [1, 2, 3, 4, 5].map((n) => ({ url: `https://example.org/source-${n}`, title: `Fixture source ${n}` }));

export function makeReportText(sections: number = RESEARCH_SECTIONS.length, baseline = true) {
  const body = RESEARCH_SECTIONS.slice(0, sections)
    .map((s, i) => `## ${i + 1}. ${s}\n- **[Evidence]** Fixture finding for ${s.toLowerCase()} drawn from source ${(i % 5) + 1}. ${"Detail sentence. ".repeat(12)}\n- **[Assumption]** Fixture modeling assumption.`)
    .join("\n\n");
  const tail = baseline ? `\n\n## 12. Baseline hypotheses check\n- H1: **Supported**. Fixture verdict.\n- H2: **Refined**. Fixture verdict.` : "";
  return `${body}\n\n## 11. Evidence quality and gaps\nFixture assessment of evidence strength and uncertainty.${tail}`;
}

export function researchResponse(opts: { searches?: number; sources?: number; sections?: number; baseline?: boolean } = {}): ResponseLike {
  const text = makeReportText(opts.sections, opts.baseline ?? true);
  const n = opts.sources ?? 5;
  return {
    id: "resp_fixture_research",
    model: "muse-spark-1.3",
    status: "completed",
    output: [
      ...Array.from({ length: opts.searches ?? 3 }, (_, i) => ({
        type: "web_search_call",
        id: `ws_${i}`,
        status: "completed",
        results: SOURCES.map((s) => ({ type: "text_result", ...s, snippet: "fixture snippet" })),
      })),
      {
        type: "message",
        id: "msg_1",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text,
            annotations: SOURCES.slice(0, n).flatMap((s, i) => [
              { type: "url_citation", url: s.url, title: s.title, start_index: i * 10, end_index: i * 10 + 5 },
              { type: "url_citation", url: s.url, title: s.title, start_index: i * 10 + 200, end_index: i * 10 + 205 },
            ]),
          },
        ],
      },
    ],
    usage: { input_tokens: 100, output_tokens: 200 },
  };
}

export function generatedProfile(overrides: Record<string, unknown> = {}) {
  return {
    persona_name: "Trend-Driven Beauty Shopper",
    description: "Discovers products through short-form video and creators, and acts on social proof when a product looks effective on camera.",
    primary_motivation: "Being early to products that look visibly effective and are widely talked about.",
    behavioral_parameters: {
      trend_sensitivity: 0.9,
      influencer_trust: 0.75,
      price_sensitivity: 0.4,
      brand_loyalty: 0.25,
      research_depth: 0.3,
      novelty_seeking: 0.85,
      impulse_buying_tendency: 0.7,
      product_quality_priority: 0.5,
      convenience_priority: 0.5,
      prestige_priority: 0.4,
    },
    shopping_behavior: {
      preferred_discovery_channels: ["Short-form video feeds", "Creator recommendations"],
      trusted_information_sources: ["Creators they follow", "Comment sections"],
      product_evaluation_criteria: ["Visible results in videos", "Volume of social buzz"],
      purchase_triggers: ["Repeated exposure to a viral product", "Limited availability"],
      rejection_criteria: ["Widespread negative creator reviews"],
      comparison_strategy: "Compares a few viral options by how often and how positively creators feature them.",
      typical_shopping_sequence: ["See product in feed", "Watch more creator videos", "Check star rating", "Buy"],
    },
    decision_rules: [
      { rule: "When encountering a viral product, check several creator recommendations before deciding.", rationale: "Social proof drives discovery.", basis: "research_supported" },
      { rule: "When reviews report significant performance complaints, buy only if social buzz remains strong.", rationale: "Willingness to experiment is high.", basis: "modeling_assumption" },
      { rule: "When comparing alternatives, prioritize visible results and buzz over ingredient lists.", rationale: "Research depth is low.", basis: "research_supported" },
    ],
    baseline_assessment: [
      { hypothesis: "Motivation: Staying current with beauty trends and discovering new products.", verdict: "supported", note: "Fixture note." },
      { hypothesis: "May tolerate higher prices or mixed reviews for highly desirable trending products.", verdict: "refined", note: "Fixture note." },
    ],
    evidence_summary: "Fixture summary of the research evidence for tests only.",
    supporting_sources: [
      { url: SOURCES[0].url, published_date: "2025-03-01", used_for: "Discovery channels" },
      { url: SOURCES[1].url, published_date: "unknown", used_for: "Social proof" },
    ],
    assumptions: ["Fixture assumption"],
    limitations: ["Fixture limitation"],
    ...overrides,
  };
}

export function generationResponse(obj: unknown = generatedProfile()): ResponseLike {
  return {
    id: "resp_fixture_generation",
    model: "muse-spark-1.3",
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(obj), annotations: [] }] }],
  };
}

export class MockClient implements MetaClient {
  calls: Record<string, unknown>[] = [];
  constructor(private responses: Array<ResponseLike | Error>) {}
  async createResponse(params: Record<string, unknown>) {
    this.calls.push(params);
    const next = this.responses.shift();
    if (!next) throw new Error("MockClient: no more responses queued");
    if (next instanceof Error) throw next;
    return next;
  }
}

// A throwaway data dir with the real persona definitions copied in.
export function tempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcl-test-"));
  const src = path.resolve(__dirname, "../data/persona-definitions");
  fs.mkdirSync(path.join(dir, "persona-definitions"));
  for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dir, "persona-definitions", f));
  return dir;
}

/* ---------- enrichment fixtures (placeholder URLs, never written to data/) ---------- */
import { RETAILER_SECTIONS } from "../server/personas/enrich.js";
import { DECISION_SCENARIOS } from "../server/personas/enrichmentSchema.js";
import { BEHAVIOR_KEYS } from "../server/personas/schema.js";

export const RETAILER_SOURCES = [1, 2, 3, 4].map((n) => ({ url: `https://example.org/retail-${n}`, title: `Retail fixture ${n}` }));

export function retailerResearchResponse(opts: { sources?: number; sections?: number } = {}): ResponseLike {
  const text = RETAILER_SECTIONS.slice(0, opts.sections ?? RETAILER_SECTIONS.length)
    .map((s, i) => `## ${i + 1}. ${s}\n- **[Retailer-specific]** Fixture point. ${"Detail. ".repeat(40)}`)
    .join("\n\n");
  return {
    id: "resp_fixture_retail",
    model: "muse-spark-1.3",
    output: [
      { type: "web_search_call", id: "ws_r", status: "completed", results: [] },
      {
        type: "message",
        content: [
          { type: "output_text", text, annotations: RETAILER_SOURCES.slice(0, opts.sources ?? 4).map((s) => ({ type: "url_citation", url: s.url, title: s.title, start_index: 0, end_index: 5 })) },
        ],
      },
    ],
  };
}

const ev = (type: string, url = "") => [{ type, source_url: url, note: "fixture" }];
const block = (url: string) => ({
  discovery: ["Opens the new arrivals page"],
  browsing: ["Scans ratings on listings"],
  comparison: ["Compares two trending items"],
  purchase: ["Adds when reviews hold up"],
  relevant_site_features: [
    { feature: "Review filters", relevance: "Checks recent reviews", source_url: url },
    { feature: "Imaginary AR mirror", relevance: "Would preview shades", source_url: "https://invented.example.com/ar" },
  ],
  differences_from_other_retailers: "Fixture difference.",
  evidence: ev("retailer_specific", url),
});

export function enrichmentJson(overrides: Record<string, unknown> = {}) {
  return {
    parameter_context: Object.fromEntries(
      BEHAVIOR_KEYS.map((k) => [
        k,
        {
          interpretation: `Fixture interpretation of ${k}.`,
          rationale: "Fixture rationale text.",
          shopping_manifestation: "Fixture manifestation text.",
          observable_actions: ["Opens trending page", "Reads top reviews"],
          sephora_example: "Fixture Sephora example text.",
          ulta_example: "Fixture Ulta example text.",
          evidence: k === "trend_sensitivity" ? ev("research_supported", "https://invented.example.com/fake") : ev("research_supported", SOURCES[0].url),
        },
      ]),
    ),
    shopping_decision_rules: DECISION_SCENARIOS.map((s) => ({
      scenario_id: s.id,
      investigate_first: "Checks review distribution.",
      information_sought: ["recent reviews"],
      conflict_weighing: "Weighs buzz against complaints.",
      purchase_triggers: ["recent positive reviews"],
      rejection_triggers: ["repeated performance complaints"],
      influencing_parameters: ["trend_sensitivity"],
      evidence: ev("inferred_rule"),
    })),
    retailer_behavior: { sephora: block(RETAILER_SOURCES[0].url), ulta: block(RETAILER_SOURCES[1].url) },
    behavioral_scenarios: [1, 2, 3, 4, 5].map((n) => ({
      scenario_id: `scenario_${n}`,
      title: `Fixture scenario ${n}`,
      retailer_setting: n % 2 ? "sephora" : "ulta",
      listings: ["A", "B"].map((l) => ({
        label: `Product ${l}`,
        description: "Fixture",
        price_usd: 20 + n,
        popularity: "high",
        brand_reputation: "known",
        social_influence: "viral",
        customer_reviews: "4.1 stars, mixed",
        performance_claims: "long wear",
        novelty: "new",
      })),
      expected_journey: ["See it", "Check reviews", "Decide"],
      parameter_influence: [{ parameter: "trend_sensitivity", effect: "Pulls toward the viral item." }],
      plausible_outcomes: [
        { outcome: "Buys A", conditions: "Recent reviews positive" },
        { outcome: "Skips", conditions: "Complaints dominate" },
      ],
    })),
    expected_observable_actions: {
      discovery: ["Opens new arrivals", "Searches a viral product name"],
      browsing: ["Scans ratings", "Opens review section"],
      comparison: ["Compares price per ml", "Checks alternatives"],
      purchase: ["Adds to basket after review check", "Adds a mini size"],
      rejection_or_substitution: ["Switches to a better-reviewed alternative"],
    },
    ...overrides,
  };
}
