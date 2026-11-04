import fs from "node:fs";
import path from "node:path";
import { META } from "./config.js";
import { PARAMETER_ANCHORS, bandOf, BANDS } from "./anchors.js";
import { DECISION_SCENARIOS, RETAILERS, type RetailerId } from "./enrichmentSchema.js";
import { MetaApiError, outputText, type MetaClient } from "./metaClient.js";
import { parseJsonOutput, PersonaValidationError, validateProfile } from "./generator.js";
import { ResearchIncompleteError, mapCitations, parseResearchResponse, saveResearchReport } from "./research.js";
import type { ResearchResult } from "./researchSchema.js";
import { BEHAVIOR_KEYS, baselineHypotheses, notesBlock, type PersonaDefinition, type PersonaProfile } from "./schema.js";

export const RETAILER_NAMES: Record<RetailerId, string> = { sephora: "Sephora", ulta: "Ulta Beauty" };

// For now the experiment is US-only. Sephora runs separate regional sites (Canada, Singapore,
// UK and others); their features and policies differ, so they never count as US evidence.
const US_SEPHORA_HOSTS = new Set(["sephora.com", "www.sephora.com", "community.sephora.com", "newsroom.sephora.com"]);
export function isNonUsRetailerUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (host.includes("sephora")) return !US_SEPHORA_HOSTS.has(host) || /^\/(ca|en-ca|fr-ca)(\/|$)/i.test(u.pathname);
  if (host.includes("ulta")) return !(host === "ulta.com" || host.endsWith(".ulta.com") || host === "ultabeauty.com" || host.endsWith(".ultabeauty.com"));
  return false;
}

export function dropNonUsSources<T extends { sources: { url: string; title: string }[] }>(r: T): T & { removed_non_us: string[] } {
  const removed = r.sources.filter((s) => isNonUsRetailerUrl(s.url)).map((s) => s.url);
  return { ...r, sources: r.sources.filter((s) => !isNonUsRetailerUrl(s.url)), removed_non_us: removed };
}

export const RETAILER_SECTIONS = [
  "Sephora: site features and shopping tools",
  "Ulta Beauty: site features and shopping tools",
  "Retailer-specific evidence on how shoppers discover, evaluate and buy",
  "How this persona's traits show up at Sephora",
  "How this persona's traits show up at Ulta Beauty",
  "Sephora versus Ulta Beauty for this persona",
  "Evidence quality and gaps",
] as const;

export const RETAILER_REQUIREMENTS = { minWebSearchCalls: 1, minUniqueSources: 3, minReportChars: 2000 };

const fmt = (n: number) => n.toFixed(2);

function profileSummary(p: PersonaProfile): string {
  const sb = p.shopping_behavior;
  return `Description: ${p.description}
Primary motivation: ${p.primary_motivation}
Behavioral parameters (0 to 1, fixed; do not change them):
${BEHAVIOR_KEYS.map((k) => `- ${k}: ${fmt(p.behavioral_parameters[k])} (${bandOf(p.behavioral_parameters[k])})`).join("\n")}
Discovery channels: ${sb.preferred_discovery_channels.join("; ")}
Trusted sources: ${sb.trusted_information_sources.join("; ")}
Evaluation criteria: ${sb.product_evaluation_criteria.join("; ")}
Purchase triggers: ${sb.purchase_triggers.join("; ")}
Rejection criteria: ${sb.rejection_criteria.join("; ")}
Comparison strategy: ${sb.comparison_strategy}
Typical sequence: ${sb.typical_shopping_sequence.join(" → ")}
Decision rules:
${p.decision_rules.map((r) => `- ${r.rule}`).join("\n")}`;
}

/* ---------------- 1. Retailer research (Meta web search) ---------------- */

export function buildRetailerResearchRequest(def: PersonaDefinition, p: PersonaProfile) {
  return {
    model: META.model,
    instructions: `You are a retail consumer-behavior analyst. A beauty-shopping simulation will run this persona on the US websites of Sephora (sephora.com) and Ulta Beauty (ulta.com). Use US sources only: do not use Sephora's regional sites (for example Canada, Singapore or the UK), because their features and policies differ. Research how shoppers with this persona's characteristics discover, evaluate, compare and buy products in those two retail environments.

Method:
- Use web search. Look for Sephora- and Ulta-specific evidence first: the retailers' own help, policy and feature pages, investor and press materials, retail trade press, and consumer research that names these retailers. Then general US beauty retail research where retailer-specific evidence is missing.
- Mark every point as **[Retailer-specific]** (a cited source is specifically about Sephora or Ulta), **[General beauty retail]** (cited, but not retailer-specific) or **[Inference]** (a reasoned translation of the persona's traits, no direct source).
- Site features: list only features you can document with a cited source (for example review filters, loyalty programs, new or trending sections, try-on tools). If a feature cannot be verified, do not list it as existing.
- Never invent statistics, studies, features or URLs. If evidence is missing, say so.
- Cite every factual claim inline as a Markdown link to the exact page you used, in the form ([page title](page URL)). Only link pages that appeared in your search results.
- Describe behavior, not demographics.

Output format (Markdown), with exactly these headings in this order:
${RETAILER_SECTIONS.map((s, i) => `## ${i + 1}. ${s}`).join("\n")}

Use 3 to 8 bullet points under each heading.`,
    input: `Persona: ${def.persona_name}
Baseline hypotheses: ${baselineHypotheses(def).join(" | ")}

Current researched profile (draft v${p.metadata.version}):
${profileSummary(p)}
${notesBlock(def)}
Research how this persona would behave on Sephora and Ulta Beauty, and which verified site features and information types matter to it.`,
    tools: [{ type: "web_search", search_context_size: "high" }],
    include: ["web_search_call.results"],
    reasoning: { effort: "high" },
    store: false,
  };
}

export function assertRetailerResearchComplete(r: ResearchResult, req = RETAILER_REQUIREMENTS) {
  const problems: string[] = [];
  if (r.web_search_calls < req.minWebSearchCalls) problems.push("The model did not perform a web search.");
  if (r.sources.length < req.minUniqueSources) problems.push(`Only ${r.sources.length} unique cited source(s); at least ${req.minUniqueSources} are required.`);
  if (r.report_text.length < req.minReportChars) problems.push(`Report is too short (${r.report_text.length} characters; minimum ${req.minReportChars}).`);
  const missing = RETAILER_SECTIONS.map((_, i) => i + 1).filter((n) => !new RegExp(`^##\\s*${n}\\.`, "m").test(r.report_text));
  if (missing.length) problems.push(`Report is missing required section(s): ${missing.join(", ")}.`);
  if (problems.length) throw new ResearchIncompleteError(`Retailer research for '${r.persona_id}' is incomplete, so the profile was not changed.`, problems);
}

/* ---------------- 2. Structured enrichment ---------------- */

const str = { type: "string" };
const strList = { type: "array", items: str };
const evidence = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["type", "source_url", "note"],
    properties: {
      type: { type: "string", enum: ["research_supported", "retailer_specific", "inferred_rule", "hypothetical_example"] },
      source_url: { type: "string", description: "A URL from the allowed source list, copied exactly, or an empty string for inferences" },
      note: str,
    },
  },
};
const retailerBlock = {
  type: "object",
  additionalProperties: false,
  required: ["discovery", "browsing", "comparison", "purchase", "relevant_site_features", "differences_from_other_retailers", "evidence"],
  properties: {
    discovery: strList,
    browsing: strList,
    comparison: strList,
    purchase: strList,
    relevant_site_features: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["feature", "relevance", "source_url"],
        properties: { feature: str, relevance: str, source_url: { type: "string", description: "Retailer-research URL documenting the feature, or empty string" } },
      },
    },
    differences_from_other_retailers: str,
    evidence,
  },
};

export const ENRICHMENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["parameter_context", "shopping_decision_rules", "retailer_behavior", "behavioral_scenarios", "expected_observable_actions"],
  properties: {
    parameter_context: {
      type: "object",
      additionalProperties: false,
      required: [...BEHAVIOR_KEYS],
      properties: Object.fromEntries(
        BEHAVIOR_KEYS.map((k) => [
          k,
          {
            type: "object",
            additionalProperties: false,
            required: ["interpretation", "rationale", "shopping_manifestation", "observable_actions", "sephora_example", "ulta_example", "evidence"],
            properties: { interpretation: str, rationale: str, shopping_manifestation: str, observable_actions: strList, sephora_example: str, ulta_example: str, evidence },
          },
        ]),
      ),
    },
    shopping_decision_rules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["scenario_id", "investigate_first", "information_sought", "conflict_weighing", "purchase_triggers", "rejection_triggers", "influencing_parameters", "evidence"],
        properties: {
          scenario_id: { type: "string", enum: DECISION_SCENARIOS.map((s) => s.id) },
          investigate_first: str,
          information_sought: strList,
          conflict_weighing: str,
          purchase_triggers: strList,
          rejection_triggers: strList,
          influencing_parameters: { type: "array", items: { type: "string", enum: [...BEHAVIOR_KEYS] } },
          evidence,
        },
      },
    },
    retailer_behavior: { type: "object", additionalProperties: false, required: [...RETAILERS], properties: { sephora: retailerBlock, ulta: retailerBlock } },
    behavioral_scenarios: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["scenario_id", "title", "retailer_setting", "listings", "expected_journey", "parameter_influence", "plausible_outcomes"],
        properties: {
          scenario_id: { type: "string", description: "lowercase_snake_case" },
          title: str,
          retailer_setting: { type: "string", enum: [...RETAILERS] },
          listings: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "description", "price_usd", "popularity", "brand_reputation", "social_influence", "customer_reviews", "performance_claims", "novelty"],
              properties: {
                label: str,
                description: str,
                price_usd: { type: "number" },
                popularity: str,
                brand_reputation: str,
                social_influence: str,
                customer_reviews: str,
                performance_claims: str,
                novelty: str,
              },
            },
          },
          expected_journey: strList,
          parameter_influence: {
            type: "array",
            items: { type: "object", additionalProperties: false, required: ["parameter", "effect"], properties: { parameter: { type: "string", enum: [...BEHAVIOR_KEYS] }, effect: str } },
          },
          plausible_outcomes: {
            type: "array",
            items: { type: "object", additionalProperties: false, required: ["outcome", "conditions"], properties: { outcome: str, conditions: str } },
          },
        },
      },
    },
    expected_observable_actions: {
      type: "object",
      additionalProperties: false,
      required: ["discovery", "browsing", "comparison", "purchase", "rejection_or_substitution"],
      properties: { discovery: strList, browsing: strList, comparison: strList, purchase: strList, rejection_or_substitution: strList },
    },
  },
};

function enrichmentInstructions() {
  return `You turn a persona's fixed behavioral scores into an operational shopping specification for an autonomous agent shopping on Sephora and Ulta Beauty.

Rules:
- The behavioral scores are fixed. Do not change or restate different numbers. Scores are relative tendencies, not probabilities: 0.90 does not mean the trait wins 90% of decisions.
- Interpret each score using the shared anchors provided, so the five personas in the simulation are comparable.
- Ground everything in the two reports provided. Tag every evidence item:
  research_supported = supported by the persona research report; retailer_specific = supported by a Sephora/Ulta-specific source in the retailer report; inferred_rule = reasoned from the persona's traits without a direct source; hypothetical_example = an illustrative example.
- source_url must be copied exactly from the allowed source list, or be an empty string. Never invent URLs, statistics or site features.
- relevant_site_features: only features the retailer report documents with a source; put that source in source_url.
- shopping_decision_rules: exactly one entry per scenario id. Describe what the persona investigates first, what it looks for, how it weighs conflicts, what triggers purchase or rejection, and which parameters drive it. Never prescribe an unconditional outcome; the agent must still react to the evidence it actually sees.
- behavioral_scenarios: at least five illustrative comparisons for this persona on Sephora or Ulta, using fictional product labels (Product A, Product B) with different combinations of price, popularity, brand reputation, social influence, customer reviews, performance and novelty. Give an expected journey, how the scores shape it, and at least two plausible outcomes with the conditions for each. These are hypothetical reference cases, not observed behavior and not predetermined outcomes.
- Sephora and Ulta examples must describe behavior on that retailer specifically, but must not assume features the retailer report did not verify.
- Do not add income, location, budget or occasion to the persona.`;
}

function enrichmentInput(def: PersonaDefinition, p: PersonaProfile, personaReport: string, retailer: ResearchResult, allowed: string[]) {
  return `Persona: ${def.persona_name} (${def.persona_id})

Shared score anchors (bands: low < ${BANDS.medium.min}, medium ${BANDS.medium.min} to ${BANDS.medium.max}, high > ${BANDS.medium.max}):
${BEHAVIOR_KEYS.map((k) => `- ${k}: ${PARAMETER_ANCHORS[k].definition} LOW: ${PARAMETER_ANCHORS[k].low} MEDIUM: ${PARAMETER_ANCHORS[k].medium} HIGH: ${PARAMETER_ANCHORS[k].high}`).join("\n")}

Current profile (draft v${p.metadata.version}):
${profileSummary(p)}
${notesBlock(def, "Persona-specific notes (use them to choose which behavioral scenarios and situations to illustrate; keep the standard output format)")}
Allowed source URLs (copy exactly):
${allowed.map((u) => `- ${u}`).join("\n")}

Persona research report:
"""
${personaReport}
"""

Retailer research report (Sephora and Ulta Beauty, performed ${retailer.research_date}):
"""
${retailer.report_text}
"""`;
}

export function buildEnrichmentRequest(def: PersonaDefinition, p: PersonaProfile, personaReport: string, retailer: ResearchResult, allowed: string[], structured = true) {
  const base = {
    model: META.model,
    instructions: enrichmentInstructions() + (structured ? "" : `\n\nReturn ONLY a JSON object matching this JSON Schema, no prose:\n${JSON.stringify(ENRICHMENT_JSON_SCHEMA)}`),
    input: enrichmentInput(def, p, personaReport, retailer, allowed),
    reasoning: { effort: "medium" },
    store: false,
  };
  return structured ? { ...base, text: { format: { type: "json_schema", name: "persona_enrichment", schema: ENRICHMENT_JSON_SCHEMA, strict: true } } } : base;
}

/* ---------------- 3. Verify and merge ---------------- */

export function mergeEnrichment(p: PersonaProfile, gen: any, retailer: ResearchResult, opts: { personaSources: string[]; reportPath: string; now?: Date }): PersonaProfile {
  const now = opts.now ?? new Date();
  const retailerUrls = new Set(retailer.sources.map((s) => s.url));
  const allowed = new Set([...opts.personaSources, ...retailerUrls]);
  let removed = 0;

  const cleanEvidence = (list: any): any[] =>
    (Array.isArray(list) ? list : []).map((e) => {
      const url = typeof e?.source_url === "string" && e.source_url.trim() ? e.source_url.trim() : null;
      let type = e?.type;
      let note = String(e?.note ?? "");
      if (url && !allowed.has(url)) {
        removed++;
        return { type: type === "hypothetical_example" ? type : "inferred_rule", source_url: null, note: `${note} (a source URL not cited during research was removed)` };
      }
      if (!url && (type === "research_supported" || type === "retailer_specific")) type = "inferred_rule";
      if (type === "retailer_specific" && url && !retailerUrls.has(url)) type = "research_supported";
      return { type, source_url: url, note };
    });

  const parameter_context = Object.fromEntries(
    BEHAVIOR_KEYS.map((k) => {
      const g = gen?.parameter_context?.[k] ?? {};
      const score = p.behavioral_parameters[k];
      return [
        k,
        {
          score,
          band: bandOf(score),
          definition: PARAMETER_ANCHORS[k].definition,
          interpretation: String(g.interpretation ?? ""),
          rationale: String(g.rationale ?? ""),
          shopping_manifestation: String(g.shopping_manifestation ?? ""),
          observable_actions: Array.isArray(g.observable_actions) ? g.observable_actions : [],
          retailer_examples: { sephora: String(g.sephora_example ?? ""), ulta: String(g.ulta_example ?? "") },
          evidence: cleanEvidence(g.evidence),
        },
      ];
    }),
  );

  const shopping_decision_rules = (Array.isArray(gen?.shopping_decision_rules) ? gen.shopping_decision_rules : []).map((r: any) => ({ ...r, evidence: cleanEvidence(r.evidence) }));

  const retailer_behavior = Object.fromEntries(
    RETAILERS.map((id) => {
      const g = gen?.retailer_behavior?.[id] ?? {};
      return [
        id,
        {
          display_name: RETAILER_NAMES[id],
          discovery: g.discovery ?? [],
          browsing: g.browsing ?? [],
          comparison: g.comparison ?? [],
          purchase: g.purchase ?? [],
          relevant_site_features: (Array.isArray(g.relevant_site_features) ? g.relevant_site_features : []).map((f: any) => {
            const url = typeof f?.source_url === "string" && retailerUrls.has(f.source_url.trim()) ? f.source_url.trim() : null;
            return { feature: String(f?.feature ?? ""), relevance: String(f?.relevance ?? ""), verified: Boolean(url), source_url: url };
          }),
          differences_from_other_retailers: String(g.differences_from_other_retailers ?? ""),
          evidence: cleanEvidence(g.evidence),
        },
      ];
    }),
  );

  const behavioral_scenarios = (Array.isArray(gen?.behavioral_scenarios) ? gen.behavioral_scenarios : []).map((s: any, i: number) => ({
    ...s,
    scenario_id: /^[a-z0-9_-]{2,40}$/.test(s?.scenario_id) ? s.scenario_id : `scenario_${i + 1}`,
    evidence_type: "hypothetical_example",
  }));

  const limitations = [...p.research_evidence.limitations];
  const note = "Retailer guidance (Sephora, Ulta Beauty) is a separable layer; site features are listed as verified only when a cited source documents them. Behavioral scenarios are hypothetical reference cases.";
  if (!limitations.includes(note)) limitations.push(note);
  if (removed) limitations.push(`${removed} evidence URL(s) proposed during enrichment were removed because they were not cited during research.`);

  return validateProfile({
    ...p,
    parameter_context,
    shopping_decision_rules,
    expected_observable_actions: gen?.expected_observable_actions,
    behavioral_scenarios,
    retailer_behavior,
    research_evidence: {
      ...p.research_evidence,
      limitations,
      retailer_research: {
        report_path: opts.reportPath,
        response_id: retailer.response_id,
        research_date: retailer.research_date,
        web_search_calls: retailer.web_search_calls,
        sources: retailer.sources,
        enriched_at: now.toISOString(),
      },
    },
    metadata: { ...p.metadata, edited_at: now.toISOString() },
  });
}

export async function runEnrichment(
  client: MetaClient,
  dataDir: string,
  def: PersonaDefinition,
  draft: PersonaProfile,
  personaResearch: ResearchResult | null,
  log: (m: string) => void = () => {},
  now = new Date(),
): Promise<{ profile: PersonaProfile; reportPath: string }> {
  if (draft.metadata.status !== "draft") throw new PersonaValidationError("Only drafts can be enriched. Start a new version of a locked persona first.");

  log("Researching Sephora and Ulta Beauty shopping behavior with Meta web search. This usually takes 1 to 3 minutes…");
  const res = await client.createResponse(buildRetailerResearchRequest(def, draft));
  let retailer = parseResearchResponse(def, res, now);
  if (retailer.sources.length < RETAILER_REQUIREMENTS.minUniqueSources && retailer.considered_results.length) {
    log("Meta returned no usable inline citations. Matching each claim to the search results it retrieved…");
    retailer = await mapCitations(client, retailer);
  }
  const usOnly = dropNonUsSources(retailer);
  if (usOnly.removed_non_us.length) log(`Removed ${usOnly.removed_non_us.length} non-US retailer source(s).`);
  retailer = { ...retailer, sources: usOnly.sources };
  try {
    assertRetailerResearchComplete(retailer);
  } catch (err) {
    // Keep the raw response so a failed run can be diagnosed without spending another call.
    const dir = path.join(dataDir, "research-reports", def.persona_id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${now.toISOString().replace(/[:.]/g, "-")}-retailers-failed.json`), JSON.stringify(res, null, 2));
    throw err;
  }
  const { markdownPath } = saveResearchReport(dataDir, retailer, def, {
    suffix: "retailers",
    title: "Retailer behavior research (Sephora, Ulta Beauty)",
    legend: "Points are marked **[Retailer-specific]**, **[General beauty retail]** or **[Inference]**.",
  });
  log(`Retailer research saved: ${retailer.web_search_calls} searches, ${retailer.sources.length} cited sources.`);

  log("Translating the scores into contextual parameters, decision rules and scenarios…");
  const personaSources = draft.research_evidence.supporting_sources.map((s) => s.url).concat(personaResearch?.sources.map((s) => s.url) ?? []);
  const allowed = [...new Set([...personaSources, ...retailer.sources.map((s) => s.url)])];
  const personaReport = personaResearch?.report_text ?? draft.research_evidence.evidence_summary;
  let out;
  try {
    out = await client.createResponse(buildEnrichmentRequest(def, draft, personaReport, retailer, allowed, true));
  } catch (err) {
    if (err instanceof MetaApiError && err.status === 400 && /text|format|schema/i.test(`${err.param} ${err.message}`)) {
      out = await client.createResponse(buildEnrichmentRequest(def, draft, personaReport, retailer, allowed, false));
    } else throw err;
  }
  const profile = mergeEnrichment(draft, parseJsonOutput(outputText(out)), retailer, { personaSources, reportPath: path.relative(dataDir, markdownPath), now });
  return { profile, reportPath: markdownPath };
}
