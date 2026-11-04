import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { generatedProfile, generationResponse, MockClient, researchResponse, SOURCES, tempDataDir } from "./fixtures";
import { researchAndDraft } from "../server/personas/pipeline";
import { PersonaStore, LockedPersonaError, IntegrityError } from "../server/personas/store";
import { getDefinition, loadDefinitions, UnknownPersonaError } from "../server/personas/registry";
import { PersonaValidationError, validateProfile, assembleProfile, generateProfile } from "../server/personas/generator";
import { ResearchIncompleteError, parseResearchResponse, buildResearchRequest } from "../server/personas/research";
import { MetaApiError, toMetaApiError, withRetries } from "../server/personas/metaClient";
import { PersonaProfileSchema } from "../server/personas/schema";
import { requireApiKey, ConfigError } from "../server/personas/config";
import { resolveShopper } from "../server/personas/shopper";

const NOW = new Date("2026-11-03T12:00:00Z");

async function draftTrend(dataDir: string) {
  const client = new MockClient([researchResponse(), generationResponse()]);
  const out = await researchAndDraft(client, dataDir, "trend-driven", { now: NOW });
  return { client, out };
}

describe("persona definitions", () => {
  it("loads the five archetypes in order", () => {
    const ids = loadDefinitions(tempDataDir()).map((d) => d.persona_id);
    expect(ids).toEqual(["trend-driven", "sensitive-skin", "time-constrained", "price-sensitive", "luxury"]);
  });

  it("carries the baseline hypotheses with no income, geography or budget", () => {
    const def = getDefinition(tempDataDir(), "trend-driven");
    expect(def.baseline.motivation).toBe("Staying current with beauty trends and discovering new products.");
    expect(def.baseline.shopping_journey).toEqual(["Social discovery", "Influencer validation", "Product research", "Purchase"]);
    for (const { note, baseline: { research_notes, ...b }, ...d } of loadDefinitions(tempDataDir())) expect(JSON.stringify({ ...d, b })).not.toMatch(/\$\d|disposable income|income of|\bcountry\b|singapore|united states/i);
  });

  it("rejects unknown and malformed persona ids", () => {
    const dir = tempDataDir();
    expect(() => getDefinition(dir, "shopaholic")).toThrow(UnknownPersonaError);
    expect(() => getDefinition(dir, "../etc/passwd")).toThrow(/Invalid persona id/);
    expect(() => getDefinition(dir, "")).toThrow(UnknownPersonaError);
    expect(() => new PersonaStore(dir).draftPath("../x")).toThrow();
  });
});

describe("research request and parsing", () => {
  it("asks for web_search via the Responses API and keeps citations", () => {
    const def = getDefinition(tempDataDir(), "trend-driven");
    const req = buildResearchRequest(def);
    expect(req.model).toBe("muse-spark-1.3");
    expect(req.tools).toEqual([{ type: "web_search", search_context_size: "high" }]);
    expect(req.input).toContain("H1. Motivation: Staying current with beauty trends");
    expect(req.input).toContain("H6. Shopping journey: Social discovery → Influencer validation → Product research → Purchase");
    const withOthers = buildResearchRequest(def, loadDefinitions(tempDataDir()));
    expect(withOthers.input).toContain("Luxury Beauty Shopper: Acquiring desirable, premium beauty products");
    expect(withOthers.input).not.toContain("Trend-Driven Beauty Shopper: Staying current");
    expect(req.instructions).toContain("## 12. Baseline hypotheses check");
    const r = parseResearchResponse(def, researchResponse(), NOW);
    expect(r.web_search_calls).toBe(3);
    expect(r.annotations).toHaveLength(10); // every url_citation preserved, including repeats
    expect(r.sources.map((s) => s.url)).toEqual(SOURCES.map((s) => s.url)); // de-duplicated
    expect(r.research_date).toBe("2026-11-03");
  });

  it("rejects research with no web search", async () => {
    const client = new MockClient([researchResponse({ searches: 0 })]);
    await expect(researchAndDraft(client, tempDataDir(), "trend-driven")).rejects.toThrow(ResearchIncompleteError);
  });

  it("rejects research with too few cited sources", async () => {
    // The citation-mapping fallback runs first; if it finds nothing new the run is still rejected.
    const noMatches = { id: "m", output: [{ type: "message", content: [{ type: "output_text", text: '{"citations":[]}' }] }] };
    const client = new MockClient([researchResponse({ sources: 1 }), noMatches]);
    await expect(researchAndDraft(client, tempDataDir(), "trend-driven")).rejects.toThrow(/unique cited source/);
  });

  it("rejects research that skipped the baseline hypotheses check", async () => {
    const client = new MockClient([researchResponse({ baseline: false })]);
    await expect(researchAndDraft(client, tempDataDir(), "trend-driven")).rejects.toThrow(/section 12 \(Baseline hypotheses check\)/);
  });

  it("rejects research missing required sections and creates no draft", async () => {
    const dir = tempDataDir();
    const client = new MockClient([researchResponse({ sections: 6 })]);
    await expect(researchAndDraft(client, dir, "trend-driven")).rejects.toThrow(/missing required section/);
    expect(new PersonaStore(dir).hasDraft("trend-driven")).toBe(false);
    expect(client.calls).toHaveLength(1); // generation never ran
  });
});

describe("profile generation and schema", () => {
  it("runs the full pipeline into a valid draft with a saved report", async () => {
    const dir = tempDataDir();
    const { client, out } = await draftTrend(dir);
    expect(client.calls).toHaveLength(2);
    expect((client.calls[1] as any).text.format.type).toBe("json_schema");
    const draft = new PersonaStore(dir).loadDraft("trend-driven");
    expect(draft.metadata).toMatchObject({ status: "draft", version: 1, content_hash: null });
    expect(draft.research_evidence.research_date).toBe("2026-11-03");
    expect(draft.research_evidence.research_response_id).toBe("resp_fixture_research");
    expect(draft.behavioral_parameters.note).toMatch(/not scientifically validated/i);
    const md = fs.readFileSync(out.reportPath, "utf8");
    expect(md).toContain("## Cited sources");
    expect(md).toContain(SOURCES[0].url);
  });

  it("removes source URLs that were not cited during research", async () => {
    const dir = tempDataDir();
    const r = parseResearchResponse(getDefinition(dir, "trend-driven"), researchResponse(), NOW);
    const gen = generatedProfile({
      supporting_sources: [
        { url: SOURCES[0].url, published_date: "unknown", used_for: "x" },
        { url: "https://invented.example.com/study", published_date: "2024", used_for: "made up" },
      ],
    });
    const p = assembleProfile(getDefinition(dir, "trend-driven"), r, gen, { reportPath: "r.md", version: 1, now: NOW });
    expect(p.research_evidence.supporting_sources.map((s) => s.url)).toEqual([SOURCES[0].url]);
    expect(p.research_evidence.limitations.join(" ")).toMatch(/1 source URL\(s\) proposed by the model were removed/);
  });

  it("enforces 0-1 bounds on behavioral scores", async () => {
    const dir = tempDataDir();
    await draftTrend(dir);
    const draft = new PersonaStore(dir).loadDraft("trend-driven");
    for (const bad of [1.2, -0.1]) {
      const broken = structuredClone(draft);
      broken.behavioral_parameters.trend_sensitivity = bad;
      expect(() => validateProfile(broken)).toThrow(/between 0 and 1/);
    }
  });

  it("keeps consumer context and mission out of the core persona", async () => {
    const dir = tempDataDir();
    await draftTrend(dir);
    const draft: any = structuredClone(new PersonaStore(dir).loadDraft("trend-driven"));
    draft.shopping_behavior.budget = 150;
    expect(() => validateProfile(draft)).toThrow(/consumer-context fields.*budget/);
    const d2: any = structuredClone(new PersonaStore(dir).loadDraft("trend-driven"));
    d2.age = 24;
    expect(() => validateProfile(d2)).toThrow(PersonaValidationError);
  });

  it("records the baseline assessment and rejects a profile without one", async () => {
    const dir = tempDataDir();
    await draftTrend(dir);
    const draft = new PersonaStore(dir).loadDraft("trend-driven");
    expect(draft.research_evidence.baseline_assessment.map((b) => b.verdict)).toEqual(["supported", "refined"]);
    const broken = structuredClone(draft);
    broken.research_evidence.baseline_assessment = [];
    expect(() => validateProfile(broken)).toThrow(/baseline hypotheses/);
  });

  it("rejects a profile with missing sections", () => {
    expect(PersonaProfileSchema.safeParse({ schema_version: 1, persona_id: "trend-driven" }).success).toBe(false);
  });

  it("falls back to prompt-constrained JSON if structured output is rejected", async () => {
    const dir = tempDataDir();
    const def = getDefinition(dir, "trend-driven");
    const r = parseResearchResponse(def, researchResponse(), NOW);
    const client = new MockClient([new MetaApiError("bad", 400, null, "text.format"), generationResponse()]);
    const p = await generateProfile(client, def, r, { reportPath: "r.md", version: 1 });
    expect(p.persona_id).toBe("trend-driven");
    expect((client.calls[1] as any).text).toBeUndefined();
  });

  it("reports unparseable model output clearly", async () => {
    const dir = tempDataDir();
    const def = getDefinition(dir, "trend-driven");
    const r = parseResearchResponse(def, researchResponse(), NOW);
    const client = new MockClient([{ id: "x", output: [{ type: "message", content: [{ type: "output_text", text: "Sorry, no JSON." }] }] }]);
    await expect(generateProfile(client, def, r, { reportPath: "r.md", version: 1 })).rejects.toThrow(/did not return a JSON object/);
  });
});

describe("locking", () => {
  it("locks with version, timestamp and content hash, and reloads without any API call", async () => {
    const dir = tempDataDir();
    await draftTrend(dir);
    const store = new PersonaStore(dir);
    const { profile } = store.lock("trend-driven", NOW);
    expect(profile.metadata).toMatchObject({ status: "locked", version: 1, approved_at: NOW.toISOString() });
    expect(profile.metadata.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const client = new MockClient([]);
    const loaded = new PersonaStore(dir).loadLocked("trend-driven");
    expect(loaded).toEqual(profile);
    expect(client.calls).toHaveLength(0);
    expect(Object.isFrozen(loaded.behavioral_parameters)).toBe(true);
  });

  it("refuses to regenerate a locked persona unless a new version is requested", async () => {
    const dir = tempDataDir();
    await draftTrend(dir);
    new PersonaStore(dir).lock("trend-driven", NOW);
    const client = new MockClient([researchResponse(), generationResponse()]);
    await expect(researchAndDraft(client, dir, "trend-driven")).rejects.toThrow(LockedPersonaError);
    expect(client.calls).toHaveLength(0);

    const out = await researchAndDraft(new MockClient([researchResponse(), generationResponse()]), dir, "trend-driven", { newVersion: true });
    expect(out.version).toBe(2);
    expect(new PersonaStore(dir).loadLocked("trend-driven").metadata.version).toBe(1); // untouched
  });

  it("blocks in-process mutation of a loaded locked persona", async () => {
    const dir = tempDataDir();
    await draftTrend(dir);
    new PersonaStore(dir).lock("trend-driven", NOW);
    const loaded: any = new PersonaStore(dir).loadLocked("trend-driven");
    expect(() => {
      "use strict";
      loaded.behavioral_parameters.trend_sensitivity = 0;
    }).toThrow(TypeError);
  });

  it("detects edits to a locked file after approval", async () => {
    const dir = tempDataDir();
    await draftTrend(dir);
    const store = new PersonaStore(dir);
    store.lock("trend-driven", NOW);
    const file = store.lockedPath("trend-driven");
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    json.behavioral_parameters.price_sensitivity = 0.99;
    fs.writeFileSync(file, JSON.stringify(json));
    expect(() => store.loadLocked("trend-driven")).toThrow(IntegrityError);
  });

  it("never overwrites an archived locked version", async () => {
    const dir = tempDataDir();
    await draftTrend(dir);
    const store = new PersonaStore(dir);
    store.lock("trend-driven", NOW);
    expect(() => store.saveDraft({ ...store.loadLocked("trend-driven"), metadata: { ...store.loadLocked("trend-driven").metadata, status: "draft", approved_at: null, content_hash: null } } as any)).toThrow(LockedPersonaError);
  });

  it("feeds a locked profile, not the provisional one, to shopping agents", async () => {
    const dir = tempDataDir();
    expect(resolveShopper(dir, "trend-driven").source).toBe("provisional");
    await draftTrend(dir);
    new PersonaStore(dir).lock("trend-driven", NOW);
    const s = resolveShopper(dir, "trend-driven");
    expect(s.source).toBe("locked");
    expect(s.config.traits.trend).toBe(90);
    expect(s.config.style).toContain("Decision rules:");
    expect(s.config.style).not.toMatch(/budget|retailer/i);
  });
});

describe("API errors", () => {
  it("explains a missing API key", () => {
    const prev = process.env.MODEL_API_KEY;
    delete process.env.MODEL_API_KEY;
    expect(() => requireApiKey()).toThrow(ConfigError);
    if (prev) process.env.MODEL_API_KEY = prev;
  });

  it("maps HTTP errors to actionable messages without leaking the key", () => {
    const e = toMetaApiError({ status: 401, error: { message: "Invalid key Bearer sk-secret-123", code: "invalid_api_key" } });
    expect(e.message).toMatch(/401.*invalid_api_key/);
    expect(e.message).toMatch(/Check that MODEL_API_KEY/);
    expect(e.message).not.toContain("sk-secret-123");
    expect(toMetaApiError({ status: 402, error: { message: "billing" } }).message).toMatch(/Billing/);
  });

  it("retries 429 then succeeds, and does not retry 400", async () => {
    let n = 0;
    const ok = await withRetries(async () => {
      if (n++ < 1) throw Object.assign(new Error("rate"), { status: 429 });
      return "ok";
    }, 3, 1);
    expect(ok).toBe("ok");
    let m = 0;
    await expect(
      withRetries(async () => {
        m++;
        throw Object.assign(new Error("bad"), { status: 400, error: { message: "bad param", param: "tools" } });
      }, 3, 1),
    ).rejects.toThrow(/400.*\[param: tools\]/);
    expect(m).toBe(1);
  });

  it("surfaces an API failure during research without creating a draft", async () => {
    const dir = tempDataDir();
    const client = new MockClient([new MetaApiError("Meta Model API error 503", 503)]);
    await expect(researchAndDraft(client, dir, "trend-driven")).rejects.toThrow(/503/);
    expect(new PersonaStore(dir).hasDraft("trend-driven")).toBe(false);
  });
});

describe("inline citation fallback", () => {
  it("accepts inline links only when the URL was in the search results", () => {
    const def = getDefinition(tempDataDir(), "trend-driven");
    const res = researchResponse({ sources: 0 });
    const msg: any = res.output.find((o: any) => o.type === "message");
    msg.content[0].text += `\n- Seen ([Fixture 1](${SOURCES[0].url}/)) and unseen ([Made up](https://invented.example.com/x)).`;
    const r = parseResearchResponse(def, res, NOW);
    expect(r.annotations).toHaveLength(0);
    expect(r.inline_citations.map((c) => c.url)).toEqual([SOURCES[0].url]);
    expect(r.sources.map((s) => s.url)).toEqual([SOURCES[0].url]);
  });
});
