import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { AgentResult, ExperimentConfig, RunShopper, StreamMessage } from "../shared/types.js";
import { CATALOG, SEPHORA_SEARCH } from "./data/catalog.js";
import { TRENDS } from "./data/trends.js";
import { runLiveAgent } from "./agent.js";
import { runSimulatedAgent } from "./simulation.js";
import { runJudge } from "./judge.js";
import { HAS_KEY, MODEL_ID, llm } from "./llm.js";
import { DEFAULT_DATA_DIR } from "./personas/config.js";
import { createMetaClient, type MetaClient } from "./personas/metaClient.js";
import { personaRouter } from "./personas/routes.js";
import { loadDefinitions } from "./personas/registry.js";
import { resolveShopper } from "./personas/shopper.js";
import { ConsumerContextSchema, ShoppingMissionSchema } from "./personas/context.js";
import { formatZodError } from "./personas/schema.js";
import { BANDS, PARAMETER_ANCHORS } from "./personas/anchors.js";
import { getScenario, SCENARIOS } from "../shared/scenarios.js";
import { signatureOf } from "../shared/consistency.js";
import { combosOf, deleteSimulation, groupSimulations, readSetup, SIM_ID, storeOf, summarize, writeSetup } from "./simulations.js";

import { browserRouter } from "./browser/check.js";
import { RETAILER_SITES, RETAILER_IDS, runBrowserAgent, emptyStats, type ResponsesClient } from "./browser/shopAgent.js";

export const RETAILER = "Persona Cart Lab demo store (curated Sephora US products)";

const defaultResponses: ResponsesClient = { create: (params, signal) => llm().responses.create(params as any, { signal }) };

export function createApp(opts: { dataDir?: string; getClient?: () => MetaClient; live?: boolean; responses?: ResponsesClient } = {}) {
  const dataDir = opts.dataDir ?? DEFAULT_DATA_DIR;
  const live = opts.live ?? HAS_KEY;
  let cached: MetaClient | null = null;
  const getClient = opts.getClient ?? (() => (cached ??= createMetaClient()));

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/browser", browserRouter());
  // Simulations: one setup and every run that came from it (see simulations.ts).
  const runsDir = path.join(dataDir, "runs");
  const storeNames = Object.fromEntries(RETAILER_IDS.map((id) => [id, RETAILER_SITES[id].name]));
  app.get("/api/simulations", (_req, res) => {
    const list = [...groupSimulations(runsDir).entries()]
      .map(([id, runs]) => summarize(id, runs, readSetup(runsDir, id), storeNames))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    res.json({ simulations: list });
  });
  app.get("/api/simulations/:id", (req, res) => {
    const runs = groupSimulations(runsDir).get(req.params.id);
    if (!runs) return res.status(404).json({ error: "Simulation not found" });
    const setup = readSetup(runsDir, req.params.id);
    res.json({
      ...summarize(req.params.id, runs, setup, storeNames),
      runs: runs.map((f) => ({ dir: f.dir, store: storeOf(f.run), ...f.run })),
      combos: combosOf(runs).map((c) => ({ personaId: c.personaId, store: c.store, runs: c.repeats.map((r) => ({ dir: r.dir, runId: r.runId, savedAt: r.savedAt })), consistency: c.consistency })),
    });
  });
  app.delete("/api/simulations/:id", (req, res) => {
    const runs = groupSimulations(runsDir).get(req.params.id);
    if (!runs) return res.status(404).json({ error: "Simulation not found" });
    try {
      deleteSimulation(runsDir, runs);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: `Could not delete: ${e.message}` });
    }
  });

  // Screenshots and saved results from live-site runs.
  app.use("/api/runs", express.static(path.join(dataDir, "runs")));

  app.get("/api/config", (_req, res) => {
    res.json({
      mode: live ? "live" : "simulation",
      model: MODEL_ID,
      retailer: RETAILER,
      archetypes: loadDefinitions(dataDir),
      anchors: { bands: BANDS, parameters: PARAMETER_ANCHORS },
      scenarios: SCENARIOS,
      retailers: RETAILER_IDS.map((id) => ({ id, name: RETAILER_SITES[id].name })),
      trends: TRENDS,
      catalog: CATALOG.map((p) => ({ ...p, link: SEPHORA_SEARCH(p) })),
    });
  });

  app.use("/api/personas", personaRouter({ dataDir, getClient }));

  // Runs every selected archetype in parallel and streams NDJSON events. Personas are resolved
  // on the server from the locked store, so a run can never alter a locked profile.
  app.post("/api/experiment", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, any>;
    const ids: string[] = Array.isArray(body.personaIds) ? body.personaIds.slice(0, 6) : [];
    const environment: string = typeof body.environment === "string" && RETAILER_SITES[body.environment] ? body.environment : "sandbox";
    const limitBy: "steps" | "minutes" = body.limitBy === "minutes" ? "minutes" : "steps";
    const minutesPerShopper = Math.min(Math.max(Math.round(Number(body.minutesPerShopper) || 5), 1), 20);
    const stepsPerShopper = Math.min(Math.max(Math.round(Number(body.stepsPerShopper) || 30), 5), 100);
    if (environment !== "sandbox" && !live) return res.status(400).json({ error: "Shopping on the live site needs the Meta API key (live mode)." });
    if (ids.length < 1) return res.status(400).json({ error: "Pick at least one persona for the run." });

    const ctx = ConsumerContextSchema.safeParse(body.context ?? {});
    if (!ctx.success) return res.status(400).json({ error: `Consumer context is invalid:\n${formatZodError(ctx.error)}` });
    const scenario = typeof body.scenarioId === "string" ? getScenario(body.scenarioId) : undefined;
    if (body.scenarioId && !scenario) return res.status(400).json({ error: `Unknown scenario ${body.scenarioId}` });
    const fromScenario = scenario
      ? {
          scenario_id: scenario.id,
          objective: `${scenario.title}: ${scenario.why}`,
          budget: scenario.budget,
          situation: scenario.why,
          shopping_list: scenario.items,
          product_categories: [...new Set(scenario.items.map((i) => i.category))],
        }
      : {};
    const mission = ShoppingMissionSchema.safeParse({
      retailer: environment === "sandbox" ? RETAILER : RETAILER_SITES[environment].name,
      currency: "USD",
      ...(body.mission ?? {}),
      ...fromScenario,
      budget: scenario ? scenario.budget : Math.min(Math.max(Number(body.mission?.budget) || 150, 20), 1000),
      objective: scenario ? `${scenario.title}: ${scenario.why}` : String(body.mission?.objective || "Build a fall skincare and everyday makeup routine.").slice(0, 400),
    });
    if (!mission.success) return res.status(400).json({ error: `Shopping mission is invalid:\n${formatZodError(mission.error)}` });

    let shoppers: RunShopper[];
    try {
      shoppers = ids.map((id) => {
        const s = resolveShopper(dataDir, id);
        return { ...s.config, source: s.source, version: s.version };
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
    // Scenario runs are only for approved, locked personas.
    if (scenario) {
      const unlocked = shoppers.filter((s) => s.source !== "locked");
      if (unlocked.length)
        return res.status(400).json({ error: `Only approved and locked personas can run a scenario. Not locked: ${unlocked.map((s) => s.name).join(", ")}. Approve and lock them in Personas first.` });
    }

    const cfg: ExperimentConfig = {
      objective: mission.data.objective,
      budget: mission.data.budget,
      personas: shoppers,
      context: ctx.data,
      mission: mission.data,
      maxSteps: 16,
    };

    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    const send = (m: StreamMessage) => res.write(JSON.stringify(m) + "\n");
    const controller = new AbortController();
    res.on("close", () => controller.abort());

    const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
    // Simulations group every run of one setup: each click, each store, each repeat.
    let simulationId = "";
    let runDir = path.join(runsDir, runId);
    if (environment !== "sandbox") {
      const limit = limitBy === "steps" ? { by: "steps", steps: stepsPerShopper } : { by: "minutes", minutes: minutesPerShopper };
      const want = typeof body.simulationId === "string" && SIM_ID.test(body.simulationId) ? body.simulationId : "";
      const existing = want ? readSetup(runsDir, want) : null;
      if (existing) {
        const st = existing.setup;
        const versions = new Map<string, number | null>(st.personas.map((p: any) => [p.id, p.version]));
        const sameConditions =
          st.scenarioId === (scenario?.id ?? null) &&
          JSON.stringify(st.limit) === JSON.stringify(limit) &&
          st.stores.includes(environment) &&
          shoppers.every((s) => versions.has(s.id) && versions.get(s.id) === s.version);
        if (!sameConditions) return res.status(400).json({ error: "This simulation's conditions have changed (personas, versions, scenario, store or limit). Start a new simulation instead." });
        simulationId = want;
      } else {
        simulationId = `sim-${runId}`;
        const stores = (Array.isArray(body.stores) ? body.stores : [environment]).filter((x: any) => typeof x === "string" && RETAILER_SITES[x]);
        writeSetup(runsDir, {
          id: simulationId,
          createdAt: new Date().toISOString(),
          setup: { scenarioId: scenario?.id ?? null, stores: stores.includes(environment) ? stores : [...stores, environment], personas: shoppers.map((s) => ({ id: s.id, version: s.version })), limit },
        });
      }
      let n = 1;
      while (fs.existsSync(path.join(runsDir, simulationId, `${environment}-${n}`))) n++;
      runDir = path.join(runsDir, simulationId, `${environment}-${n}`);
      fs.mkdirSync(runDir, { recursive: true });
    }
    send({ kind: "meta", mode: live ? "live" : "simulation", model: MODEL_ID, runId, shoppers, context: cfg.context, mission: cfg.mission, environment, simulationId });

    const runOne = async (p: RunShopper): Promise<AgentResult> => {
        send({ kind: "event", event: { type: "status", agent: p.id, status: "running" } });
        try {
          const emit = (event: any) => send({ kind: "event", event });
          const r =
            environment !== "sandbox"
              ? await runBrowserAgent(p, cfg, emit, controller.signal, {
                  client: opts.responses ?? defaultResponses,
                  retailer: environment,
                  headless: false,
                  limitBy,
                  maxSteps: stepsPerShopper,
                  maxMinutes: minutesPerShopper,
                  shotDir: path.join(runDir, p.id),
                })
              : live
                ? await runLiveAgent(p, cfg, emit, controller.signal)
                : await runSimulatedAgent(p, cfg, emit);
          send({ kind: "event", event: { type: "status", agent: p.id, status: "done" } });
          return r;
        } catch (err: any) {
          const message = err?.message ?? String(err);
          console.error(`[${p.id}]`, message);
          send({ kind: "event", event: { type: "status", agent: p.id, status: "error", message } });
          return { personaId: p.id, items: [], total: 0, summary: "", stats: emptyStats(), error: message };
        }
      };
    // Live-site runs go one persona at a time (one visible browser window, gentler on the site).
    const results: AgentResult[] = [];
    let lastJudge: import("../shared/types.js").JudgeResult | null = null;
    if (environment === "sandbox") results.push(...(await Promise.all(shoppers.map(runOne))));
    else for (const p of shoppers) {
      if (controller.signal.aborted) break;
      results.push(await runOne(p));
    }
    send({ kind: "results", results });

    if (results.filter((r) => !r.error).length >= 2) {
      try {
        lastJudge = await runJudge(results, shoppers, cfg, live);
        send({ kind: "judge", judge: lastJudge });
      } catch (err: any) {
        send({ kind: "judge_error", message: err?.message ?? String(err) });
      }
    }
    if (environment !== "sandbox") {
      try {
        for (const r of results) if (!r.error) r.signature = signatureOf(r, cfg.mission);
        fs.mkdirSync(runDir, { recursive: true });
        fs.writeFileSync(
          path.join(runDir, "run.json"),
          JSON.stringify({ runId, simulationId, store: environment, environment, cancelled: controller.signal.aborted, model: MODEL_ID, shoppers: shoppers.map(({ style, ...s }) => s), context: cfg.context, mission: cfg.mission, results, judge: lastJudge, savedAt: new Date().toISOString() }, null, 2),
        );
      } catch (e: any) {
        console.error("Could not save run", e.message);
      }
    }
    send({ kind: "done" });
    res.end();
  });

  const here = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(here, "../web/dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  return app;
}
