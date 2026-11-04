import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { enrichmentJson, generationResponse, MockClient, researchResponse, retailerResearchResponse, RETAILER_SOURCES, SOURCES, tempDataDir } from "./fixtures";
import { researchAndDraft } from "../server/personas/pipeline";
import { PersonaStore } from "../server/personas/store";
import { getDefinition } from "../server/personas/registry";
import { runEnrichment, buildRetailerResearchRequest, buildEnrichmentRequest } from "../server/personas/enrich";
import { validateProfile } from "../server/personas/generator";
import { ResearchIncompleteError } from "../server/personas/research";
import { resolveShopper } from "../server/personas/shopper";
import { bandOf } from "../server/personas/anchors";

const respond = (obj: unknown) => ({ id: "resp_fixture_enrich", model: "muse-spark-1.3", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(obj) }] }] });

async function draftAndEnrich(enrich = enrichmentJson()) {
  const dir = tempDataDir();
  await researchAndDraft(new MockClient([researchResponse(), generationResponse()]), dir, "trend-driven");
  const store = new PersonaStore(dir);
  const before = store.loadDraft("trend-driven");
  const client = new MockClient([retailerResearchResponse(), respond(enrich)]);
  const { profile } = await runEnrichment(client, dir, getDefinition(dir, "trend-driven"), before, null);
  store.saveDraft(profile);
  return { dir, store, before, after: store.loadDraft("trend-driven"), client };
}

describe("retailer enrichment", () => {
  it("researches Sephora and Ulta with web search and asks for structured output", async () => {
    const { client } = await draftAndEnrich();
    const [research, gen] = client.calls as any[];
    expect(research.tools).toEqual([{ type: "web_search", search_context_size: "high" }]);
    expect(research.instructions).toContain("## 1. Sephora: site features and shopping tools");
    expect(research.instructions).toContain("[Retailer-specific]");
    expect(gen.text.format.name).toBe("persona_enrichment");
  });

  it("enriches the existing draft without changing scores, identity or status", async () => {
    const { before, after } = await draftAndEnrich();
    expect(after.behavioral_parameters).toEqual(before.behavioral_parameters);
    expect(after.decision_rules).toEqual(before.decision_rules);
    expect(after.research_evidence.supporting_sources).toEqual(before.research_evidence.supporting_sources);
    expect(after.metadata.status).toBe("draft");
    expect(after.metadata.version).toBe(1);
    expect(after.parameter_context!.trend_sensitivity.score).toBe(before.behavioral_parameters.trend_sensitivity);
    expect(after.parameter_context!.trend_sensitivity.band).toBe(bandOf(before.behavioral_parameters.trend_sensitivity));
    expect(after.shopping_decision_rules).toHaveLength(7);
    expect(after.behavioral_scenarios!.every((s) => s.evidence_type === "hypothetical_example")).toBe(true);
    expect(after.retailer_behavior!.sephora.display_name).toBe("Sephora");
    expect(after.research_evidence.retailer_research!.sources).toHaveLength(4);
  });

  it("marks site features verified only when a retailer source documents them", async () => {
    const { after } = await draftAndEnrich();
    const f = after.retailer_behavior!.sephora.relevant_site_features;
    expect(f[0]).toMatchObject({ feature: "Review filters", verified: true, source_url: RETAILER_SOURCES[0].url });
    expect(f[1]).toMatchObject({ feature: "Imaginary AR mirror", verified: false, source_url: null });
  });

  it("removes evidence URLs that were never cited and downgrades the claim", async () => {
    const { after } = await draftAndEnrich();
    const e = after.parameter_context!.trend_sensitivity.evidence[0];
    expect(e).toMatchObject({ type: "inferred_rule", source_url: null });
    expect(after.parameter_context!.price_sensitivity.evidence[0]).toMatchObject({ type: "research_supported", source_url: SOURCES[0].url });
    expect(after.research_evidence.limitations.join(" ")).toMatch(/1 evidence URL\(s\) proposed during enrichment were removed/);
  });

  it("rejects enrichment missing a decision scenario or with fewer than five behavioral scenarios", async () => {
    const short = enrichmentJson();
    (short as any).behavioral_scenarios = (short as any).behavioral_scenarios.slice(0, 3);
    await expect(draftAndEnrich(short)).rejects.toThrow(/At least five behavioral scenarios/);
    const missing = enrichmentJson();
    (missing as any).shopping_decision_rules = (missing as any).shopping_decision_rules.slice(1);
    await expect(draftAndEnrich(missing)).rejects.toThrow(/Missing decision rule for 'viral_mixed_reviews'/);
  });

  it("rejects thin retailer research and leaves the draft untouched", async () => {
    const dir = tempDataDir();
    await researchAndDraft(new MockClient([researchResponse(), generationResponse()]), dir, "trend-driven");
    const store = new PersonaStore(dir);
    const before = fs.readFileSync(store.draftPath("trend-driven"), "utf8");
    await expect(runEnrichment(new MockClient([retailerResearchResponse({ sources: 1 })]), dir, getDefinition(dir, "trend-driven"), store.loadDraft("trend-driven"), null)).rejects.toThrow(ResearchIncompleteError);
    expect(fs.readFileSync(store.draftPath("trend-driven"), "utf8")).toBe(before);
  });

  it("maps claims to retrieved search results when Meta returns no citations, dropping invalid ids", async () => {
    const dir = tempDataDir();
    await researchAndDraft(new MockClient([researchResponse(), generationResponse()]), dir, "trend-driven");
    const store = new PersonaStore(dir);
    const bare: any = retailerResearchResponse({ sources: 0 });
    bare.output[0].results = RETAILER_SOURCES.map((s) => ({ type: "text_result", ...s, snippet: "" }));
    const mapping = respond({ citations: [{ claim: "Sephora has review filters", result_ids: [0, 1, 2, 99] }] });
    const client = new MockClient([bare, mapping, respond(enrichmentJson())]);
    const { profile } = await runEnrichment(client, dir, getDefinition(dir, "trend-driven"), store.loadDraft("trend-driven"), null);
    expect((client.calls[1] as any).text.format.name).toBe("citation_map");
    expect((client.calls[1] as any).tools).toBeUndefined();
    expect(profile.research_evidence.retailer_research!.sources.map((s) => s.url)).toEqual(RETAILER_SOURCES.slice(0, 3).map((s) => s.url));
    const md = fs.readFileSync(`${dir}/${profile.research_evidence.retailer_research!.report_path}`, "utf8");
    expect(md).toContain("Claims mapped to Meta search results after research");
    expect(md).toContain("## Claim-to-source mapping");
  });

  it("keeps context scores consistent with behavioral scores", async () => {
    const { after } = await draftAndEnrich();
    const broken = structuredClone(after);
    broken.parameter_context!.trend_sensitivity.score = 0.1;
    expect(() => validateProfile(broken)).toThrow(/Context score must equal/);
  });

  it("locks an enriched profile and feeds its decision rules to shopping agents", async () => {
    const { dir, store } = await draftAndEnrich();
    store.lock("trend-driven");
    const loaded = new PersonaStore(dir).loadLocked("trend-driven");
    expect(loaded.shopping_decision_rules).toHaveLength(7);
    expect(resolveShopper(dir, "trend-driven").config.style).toContain("How you handle common situations");
  });

  it("loads profiles created before enrichment", async () => {
    const dir = tempDataDir();
    await researchAndDraft(new MockClient([researchResponse(), generationResponse()]), dir, "trend-driven");
    expect(new PersonaStore(dir).loadDraft("trend-driven").parameter_context).toBeUndefined();
  });
});

describe("US-only retailer sources", () => {
  it("classifies regional Sephora sites as non-US", async () => {
    const { isNonUsRetailerUrl } = await import("../server/personas/enrich");
    expect(isNonUsRetailerUrl("https://www.sephora.com/buy/trending-products")).toBe(false);
    expect(isNonUsRetailerUrl("https://community.sephora.com/t5/x")).toBe(false);
    expect(isNonUsRetailerUrl("https://www.ulta.com/rewards/all")).toBe(false);
    expect(isNonUsRetailerUrl("https://www.sephora.com/ca/en/beauty/ratings-reviews")).toBe(true);
    expect(isNonUsRetailerUrl("https://admin.sephora.sg/pages/virtual-artist-sg")).toBe(true);
    expect(isNonUsRetailerUrl("https://www.sephora.co.uk/")).toBe(true);
    expect(isNonUsRetailerUrl("https://yougov.com/en-us/articles/1")).toBe(false);
  });

  it("drops non-US sources so features they document are not verified", async () => {
    const dir = tempDataDir();
    await researchAndDraft(new MockClient([researchResponse(), generationResponse()]), dir, "trend-driven");
    const store = new PersonaStore(dir);
    const r: any = retailerResearchResponse();
    const ann = r.output[1].content[0].annotations;
    ann[0].url = "https://www.sephora.com/ca/en/beauty/ratings-reviews"; // the source the Sephora feature uses
    const gen = enrichmentJson();
    (gen as any).retailer_behavior.sephora.relevant_site_features[0].source_url = ann[0].url;
    (gen as any).retailer_behavior.sephora.evidence[0].source_url = ann[0].url;
    const { profile } = await runEnrichment(new MockClient([r, respond(gen)]), dir, getDefinition(dir, "trend-driven"), store.loadDraft("trend-driven"), null);
    expect(profile.research_evidence.retailer_research!.sources.map((s) => s.url)).not.toContain(ann[0].url);
    expect(profile.retailer_behavior!.sephora.relevant_site_features[0]).toMatchObject({ verified: false, source_url: null });
  });
});
