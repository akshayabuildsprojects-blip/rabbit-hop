import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { enrichmentJson, generationResponse, MockClient, researchResponse, retailerResearchResponse, tempDataDir } from "./fixtures";

let base = "";
let close: () => void;
const client = new MockClient([]);
const queue = (...r: any[]) => ((client as any).responses = r);
const respond = (obj: unknown) => ({ id: "resp_enrich", model: "muse-spark-1.3", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(obj) }] }] });
const fullRun = () => queue(researchResponse(), generationResponse(), retailerResearchResponse(), respond(enrichmentJson()));

beforeAll(async () => {
  const app = createApp({ dataDir: tempDataDir(), getClient: () => client, live: false });
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => close());

const json = (path: string, init?: RequestInit) => fetch(base + path, { headers: { "content-type": "application/json" }, ...init }).then(async (r) => ({ status: r.status, body: await r.json() }));
const stream = (path: string) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then(async (r) => (await r.text()).trim().split("\n").map((l) => JSON.parse(l)));

describe("persona API: configure, regenerate, lock", () => {
  it("lists five archetypes, none researched", async () => {
    const { body } = await json("/api/personas");
    expect(body.personas).toHaveLength(5);
    expect(body.personas.every((p: any) => p.status === "not researched" && !p.hasRetailContext)).toBe(true);
  });

  it("regenerates in four steps and saves one complete draft", async () => {
    fullRun();
    const lines = await stream("/api/personas/trend-driven/regenerate");
    const steps = lines.filter((l) => l.kind === "progress").map((l) => l.message);
    expect(steps.some((m) => m.startsWith("Step 1 of 4"))).toBe(true);
    expect(steps.some((m) => m.startsWith("Step 3 of 4"))).toBe(true);
    expect(lines.at(-1)).toMatchObject({ kind: "done", version: 1 });

    const { body } = await json("/api/personas/trend-driven");
    expect(body.status).toBe("draft");
    expect(body.draft.parameter_context).toBeTruthy();
    expect(body.draft.research_evidence.baseline_snapshot.motivation).toBe(body.definition.baseline.motivation);
    expect(body.baselineChanged).toBe(false);
    expect(body.research.sources).toHaveLength(5);
    expect(body.retailerResearch.sources).toHaveLength(4);
  });

  it("no longer allows editing results directly", async () => {
    const r = await fetch(`${base}/api/personas/trend-driven/draft`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ behavioral_parameters: { trend_sensitivity: 0.1 } }) });
    expect(r.status).toBe(404);
  });

  it("saves a baseline edit and flags the findings as out of date", async () => {
    const current = (await json("/api/personas/trend-driven")).body.definition.baseline;
    const { status } = await json("/api/personas/trend-driven/baseline", { method: "PUT", body: JSON.stringify({ baseline: { ...current, motivation: "Being first to try what is going viral." } }) });
    expect(status).toBe(200);
    const detail = (await json("/api/personas/trend-driven")).body;
    expect(detail.definition.baseline.motivation).toBe("Being first to try what is going viral.");
    expect(detail.baselineChanged).toBe(true);
    expect(detail.draft.primary_motivation).not.toBe("Being first to try what is going viral."); // findings untouched
    expect((await json("/api/personas")).body.personas[0].baselineChanged).toBe(true);
  });

  it("rejects an incomplete baseline", async () => {
    const { status, body } = await json("/api/personas/trend-driven/baseline", { method: "PUT", body: JSON.stringify({ baseline: { motivation: "x", characteristics: [], shopping_journey: [] } }) });
    expect(status).toBe(422);
    expect(body.error).toMatch(/baseline is incomplete/);
  });

  it("leaves the existing draft untouched when regeneration fails", async () => {
    const before = (await json("/api/personas/trend-driven")).body.draft;
    queue(researchResponse(), generationResponse(), retailerResearchResponse({ sources: 1 }));
    const lines = await stream("/api/personas/trend-driven/regenerate");
    expect(lines.at(-1).kind).toBe("error");
    expect((await json("/api/personas/trend-driven")).body.draft).toEqual(before);
  });

  it("requires explicit confirmation to lock", async () => {
    expect((await json("/api/personas/trend-driven/lock", { method: "POST", body: "{}" })).status).toBe(400);
    const { status, body } = await json("/api/personas/trend-driven/lock", { method: "POST", body: JSON.stringify({ confirm: "trend-driven" }) });
    expect(status).toBe(200);
    expect(body.locked.metadata.status).toBe("locked");
  });

  it("regenerating a locked persona creates v2 and leaves v1 in use", async () => {
    fullRun();
    const lines = await stream("/api/personas/trend-driven/regenerate");
    expect(lines.at(-1)).toMatchObject({ kind: "done", version: 2 });
    const detail = (await json("/api/personas/trend-driven")).body;
    expect(detail.status).toBe("locked + new draft");
    expect(detail.locked.metadata.version).toBe(1);
    expect(detail.draft.metadata.version).toBe(2);
  });

  it("runs an experiment with the locked persona plus context and mission", async () => {
    const ac = new AbortController();
    const resp = await fetch(`${base}/api/experiment`, {
      method: "POST",
      signal: ac.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        personaIds: ["trend-driven", "price-sensitive"],
        context: { country: "Singapore", disposable_income: "middle" },
        mission: { budget: 120, objective: "Build a humid-weather routine", product_categories: ["sunscreen", "serum"] },
      }),
    });
    const reader = resp.body!.getReader();
    let buf = "";
    while (!buf.includes("\n")) buf += new TextDecoder().decode((await reader.read()).value);
    ac.abort();
    const meta = JSON.parse(buf.split("\n")[0]);
    expect(meta.shoppers.map((s: any) => [s.id, s.source, s.version])).toEqual([
      ["trend-driven", "locked", 1],
      ["price-sensitive", "provisional", null],
    ]);
  });

  it("returns 404 for unknown personas", async () => {
    expect((await json("/api/personas/nope")).status).toBe(404);
  });
});

describe("scenarios", () => {
  it("lists the archetype histories and serves one", async () => {
    const list = await json("/api/prior-data");
    expect(list.status).toBe(200);
    expect(list.body.map((f: any) => f.personaId).sort()).toEqual(["luxury", "price-sensitive", "sensitive-skin", "time-constrained", "trend-driven"]);
    expect(list.body.every((f: any) => f.rows === 100)).toBe(true);
    const one = await json("/api/prior-data/luxury");
    expect(one.body.rows[0]).toHaveProperty("brand");
    expect((await json("/api/prior-data/nobody")).status).toBe(404);
  });

  it("lists the curated scenarios in config", async () => {
    const { body } = await json("/api/config");
    expect(body.scenarios.map((s: any) => s.id)).toEqual(["new-vanity", "running-low", "night-out", "skincare-reset"]);
  });
  it("refuses a scenario run for personas that are not locked", async () => {
    const { status, body } = await json("/api/experiment", { method: "POST", body: JSON.stringify({ personaIds: ["luxury"], scenarioId: "new-vanity" }) });
    expect(status).toBe(400);
    expect(body.error).toMatch(/Only approved and locked personas/);
  });
  it("rejects an unknown scenario", async () => {
    const { status } = await json("/api/experiment", { method: "POST", body: JSON.stringify({ personaIds: ["luxury"], scenarioId: "nope" }) });
    expect(status).toBe(400);
  });
});
