import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { AgentResult, ExperimentConfig, StreamMessage } from "../shared/types.js";
import { CATALOG, SEPHORA_SEARCH } from "./data/catalog.js";
import { PERSONAS, personaById } from "./data/personas.js";
import { TRENDS } from "./data/trends.js";
import { runLiveAgent } from "./agent.js";
import { runSimulatedAgent } from "./simulation.js";
import { runJudge } from "./judge.js";
import { HAS_KEY, MODEL_ID } from "./llm.js";

const app = express();
app.use(express.json());

app.get("/api/config", (_req, res) => {
  res.json({
    mode: HAS_KEY ? "live" : "simulation",
    model: MODEL_ID,
    personas: PERSONAS.map(({ systemPrompt, ...p }) => p),
    trends: TRENDS,
    catalog: CATALOG.map((p) => ({ ...p, link: SEPHORA_SEARCH(p) })),
  });
});

// Runs every selected persona agent in parallel and streams NDJSON events.
app.post("/api/experiment", async (req, res) => {
  const body = req.body as Partial<ExperimentConfig>;
  const cfg: ExperimentConfig = {
    objective: String(body.objective || "Build a fall skincare and everyday makeup routine.").slice(0, 400),
    budget: Math.min(Math.max(Number(body.budget) || 150, 20), 1000),
    personaIds: (body.personaIds ?? PERSONAS.map((p) => p.id)).filter((id) => personaById.has(id)),
    maxSteps: 16,
  };
  if (!cfg.personaIds.length) return res.status(400).json({ error: "Pick at least one persona." });

  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  const send = (m: StreamMessage) => res.write(JSON.stringify(m) + "\n");
  const controller = new AbortController();
  res.on("close", () => controller.abort());

  send({ kind: "meta", mode: HAS_KEY ? "live" : "simulation", model: MODEL_ID, runId: randomUUID() });

  const personas = cfg.personaIds.map((id) => personaById.get(id)!);
  const results: AgentResult[] = await Promise.all(
    personas.map(async (p) => {
      send({ kind: "event", event: { type: "status", agent: p.id, status: "running" } });
      try {
        const emit = (event: any) => send({ kind: "event", event });
        const r = HAS_KEY ? await runLiveAgent(p, cfg, emit, controller.signal) : await runSimulatedAgent(p, cfg, emit);
        send({ kind: "event", event: { type: "status", agent: p.id, status: "done" } });
        return r;
      } catch (err: any) {
        const message = err?.message ?? String(err);
        console.error(`[${p.id}]`, message);
        send({ kind: "event", event: { type: "status", agent: p.id, status: "error", message } });
        return { personaId: p.id, items: [], total: 0, summary: "", stats: { steps: 0, searches: 0, productsInspected: 0, trendChecks: 0, alternativesChecked: 0, removals: 0 }, error: message };
      }
    }),
  );
  send({ kind: "results", results });

  if (results.filter((r) => !r.error).length >= 2) {
    try {
      send({ kind: "judge", judge: await runJudge(results, personas, HAS_KEY) });
    } catch (err: any) {
      send({ kind: "judge_error", message: err?.message ?? String(err) });
    }
  }
  send({ kind: "done" });
  res.end();
});

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../web/dist");
app.use(express.static(dist));
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));

const port = Number(process.env.PORT) || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log(`Persona Cart Lab on http://localhost:${port} (${HAS_KEY ? `live, ${MODEL_ID}` : "simulation mode: set MODEL_API_KEY for Muse Spark"})`);
});
