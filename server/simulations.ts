import fs from "node:fs";
import path from "node:path";
import { consistencyOf, signatureOf } from "../shared/consistency.js";

// A simulation is one setup (shoppers, scenario, stores, limit) and every run that came from it.
// Layout under data/runs:
//   <simulationId>/simulation.json          the fixed setup
//   <simulationId>/<store>-<n>/run.json      one click's run on one store (one or more personas)
//   <simulationId>/<store>-<n>/<persona>/    that persona's screenshots
// Older runs (flat <runId>/run.json, or exp-*/iter-N/run.json) are grouped automatically.

export const SIM_ID = /^[\w-]{6,90}$/;

export interface RunFile {
  dir: string; // relative to the runs folder
  run: any;
}

export function listRunFiles(runsDir: string): RunFile[] {
  const out: RunFile[] = [];
  const walk = (rel: string, depth: number) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(path.join(runsDir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isFile() && e.name === "run.json") {
        try {
          out.push({ dir: rel, run: JSON.parse(fs.readFileSync(path.join(runsDir, rel, "run.json"), "utf8")) });
        } catch {}
      } else if (e.isDirectory() && depth < 2) walk(path.join(rel, e.name), depth + 1);
    }
  };
  walk("", 0);
  return out;
}

const topSegment = (dir: string) => dir.split(path.sep)[0];
const groupOf = (f: RunFile) => f.run.simulationId ?? (f.run.experimentId ? topSegment(f.dir) : topSegment(f.dir) || f.run.runId);

export function groupSimulations(runsDir: string): Map<string, RunFile[]> {
  const groups = new Map<string, RunFile[]>();
  for (const f of listRunFiles(runsDir)) {
    const id = groupOf(f);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(f);
  }
  for (const runs of groups.values()) runs.sort((a, b) => String(a.run.savedAt).localeCompare(String(b.run.savedAt)));
  mergeLegacyMultiStore(groups);
  return groups;
}

// Runs saved before simulations existed: a two-store click was saved as two separate groups.
// Rejoin them when the second store started within seconds of the first finishing, with the same
// shoppers and scenario on a different store.
const startOf = (id: string) => {
  const m = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(id);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN;
};
function mergeLegacyMultiStore(groups: Map<string, RunFile[]>) {
  const legacy = [...groups.entries()].filter(([, runs]) => runs.every((f) => !f.run.simulationId) && runs.length === 1);
  legacy.sort((a, b) => startOf(a[0]) - startOf(b[0]));
  for (let i = 1; i < legacy.length; i++) {
    const [prevId, prev] = legacy[i - 1];
    const [id, cur] = legacy[i];
    if (!groups.has(prevId) || !groups.has(id)) continue;
    const a = prev[0].run, b = cur[0].run;
    const gap = startOf(id) - Date.parse(a.savedAt);
    const same = JSON.stringify((a.shoppers ?? []).map((x: any) => x.id)) === JSON.stringify((b.shoppers ?? []).map((x: any) => x.id)) && a.mission?.objective === b.mission?.objective;
    if (same && storeOf(a) !== storeOf(b) && gap >= 0 && gap < 10_000) {
      groups.set(prevId, [...prev, ...cur]);
      groups.delete(id);
      legacy[i] = [prevId, groups.get(prevId)!];
    }
  }
}

export function readSetup(runsDir: string, id: string): any | null {
  if (!SIM_ID.test(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(runsDir, id, "simulation.json"), "utf8"));
  } catch {
    return null;
  }
}

export function writeSetup(runsDir: string, sim: any) {
  fs.mkdirSync(path.join(runsDir, sim.id), { recursive: true });
  fs.writeFileSync(path.join(runsDir, sim.id, "simulation.json"), JSON.stringify(sim, null, 2));
}

export const storeOf = (run: any) => run.store ?? run.environment ?? "sephora";

const statusOf = (results: any[]) => (results.some((x) => x.blocked) ? "blocked by the site" : results.length && results.every((x) => x.error) ? "failed" : results.some((x) => x.error) ? "partly failed" : results.every((x) => x.summary || x.items?.length) ? "finished" : "stopped");

// Every persona + store combination with its repeats in time order, and its consistency.
export function combosOf(runs: RunFile[]) {
  const map = new Map<string, { personaId: string; store: string; repeats: { dir: string; runId: string; savedAt: string; result: any; mission: any }[] }>();
  for (const f of runs) {
    for (const r of f.run.results ?? []) {
      const store = storeOf(f.run);
      const key = `${r.personaId}|${store}`;
      if (!map.has(key)) map.set(key, { personaId: r.personaId, store, repeats: [] });
      map.get(key)!.repeats.push({ dir: f.dir, runId: f.run.runId, savedAt: f.run.savedAt, result: r, mission: f.run.mission });
    }
  }
  return [...map.values()].map((c) => {
    const ok = c.repeats.filter((x) => !x.result.error);
    return { ...c, consistency: consistencyOf(c.personaId, ok.map((x) => x.result.signature ?? signatureOf(x.result, x.mission))) };
  });
}

export function summarize(id: string, runs: RunFile[], setup: any | null, storeNames: Record<string, string>) {
  const first = runs[0]?.run ?? {};
  const last = runs[runs.length - 1]?.run ?? {};
  const shoppers = new Map<string, any>();
  for (const f of runs) for (const s of f.run.shoppers ?? []) shoppers.set(s.id, { id: s.id, name: s.name, color: s.color, version: s.version });
  const stores = [...new Set(runs.map((f) => storeOf(f.run)))];
  const combos = combosOf(runs);
  return {
    id,
    scenario: first.mission?.objective ?? "",
    budget: first.mission?.budget ?? null,
    createdAt: first.savedAt,
    updatedAt: last.savedAt,
    shoppers: [...shoppers.values()],
    stores: stores.map((s) => {
      const latest = [...runs].reverse().find((f) => storeOf(f.run) === s);
      return { id: s, name: storeNames[s] ?? s, status: statusOf(latest?.run.results ?? []) };
    }),
    repeats: combos.length ? Math.max(...combos.map((c) => c.repeats.length)) : 0,
    runs: runs.length,
    setup: setup?.setup ?? null,
  };
}

// Deletes every folder that belongs to the simulation, inside the runs folder only.
export function deleteSimulation(runsDir: string, runs: RunFile[]) {
  const root = path.resolve(runsDir) + path.sep;
  for (const top of new Set(runs.map((f) => topSegment(f.dir)).filter(Boolean))) {
    const full = path.resolve(runsDir, top);
    if (full.startsWith(root)) fs.rmSync(full, { recursive: true, force: true });
  }
}
