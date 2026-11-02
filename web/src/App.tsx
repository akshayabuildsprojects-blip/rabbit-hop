import { useEffect, useRef, useState } from "react";
import type { Persona, TrendSignal } from "../../shared/types";
import { useExperiment, type LaneState } from "./useExperiment";
import { Results } from "./Results";

type PublicPersona = Omit<Persona, "systemPrompt">;
interface Config {
  mode: "live" | "simulation";
  model: string;
  personas: PublicPersona[];
  trends: TrendSignal[];
  catalog: { id: string }[];
}

const DEFAULT_GOAL = "Build a fall skincare and everyday makeup routine.";

export const INFLUENCE_LABEL: Record<string, string> = {
  trend: "Trend",
  reviews: "Reviews",
  ingredients: "Ingredients",
  price: "Price",
  brand_prestige: "Prestige",
  dupe: "Dupe",
};

const TOOL_GLYPH: Record<string, string> = {
  view_trend_feed: "◎",
  search_catalog: "⌕",
  get_product_details: "◇",
  find_alternatives: "⇄",
  add_to_basket: "+",
  remove_from_basket: "−",
  finalize_basket: "✓",
};

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [objective, setObjective] = useState(DEFAULT_GOAL);
  const [budget, setBudget] = useState(150);
  const [selected, setSelected] = useState<string[]>([]);
  const exp = useExperiment();

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: Config) => {
        setConfig(c);
        setSelected(c.personas.map((p) => p.id));
      })
      .catch(() => setLoadError("Could not reach the server. Start it with npm run dev and reload."));
  }, []);

  const busy = exp.phase === "shopping" || exp.phase === "judging";
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const activePersonas = config?.personas.filter((p) => (busy || exp.results ? exp.lanes[p.id] : selected.includes(p.id))) ?? [];

  if (loadError) return <p className="p-8 text-ink-2">{loadError}</p>;
  if (!config) return <p className="p-8 text-muted">Loading the lab…</p>;

  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-24 sm:px-8">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line py-5">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">Persona Cart Lab</h1>
        <p className="text-sm text-muted">
          Agents run on Meta <span className="font-medium text-ink-2">{config.model}</span> through Meta Model API
        </p>
      </header>

      {config.mode === "simulation" && (
        <p className="mt-4 rounded-md border border-line bg-panel px-4 py-3 text-sm text-ink-2">
          Simulation mode. No <code>MODEL_API_KEY</code> is set, so scripted agents stand in for Muse Spark. Add the key to run the real experiment.
        </p>
      )}

      {/* Setup */}
      <section className="grid gap-8 py-10 lg:grid-cols-[1.4fr_1fr]" aria-label="Experiment setup">
        <div>
          <label htmlFor="goal" className="text-sm font-medium text-muted">
            Every agent gets the same shopping goal
          </label>
          <textarea
            id="goal"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            rows={2}
            disabled={busy}
            className="mt-2 w-full resize-none bg-transparent font-display text-3xl font-bold leading-tight tracking-tight text-ink outline-none placeholder:text-muted sm:text-5xl"
          />
          <div className="mt-6 flex flex-wrap items-end gap-x-10 gap-y-4">
            <div>
              <label htmlFor="budget" className="text-sm font-medium text-muted">
                Budget
              </label>
              <div className="flex items-center gap-4">
                <span className="tabular font-display text-4xl font-bold">${budget}</span>
                <input id="budget" type="range" min={40} max={500} step={10} value={budget} disabled={busy} onChange={(e) => setBudget(Number(e.target.value))} className="w-48 accent-[var(--ink)]" />
              </div>
            </div>
            <p className="max-w-sm text-sm text-ink-2">
              Same {config.catalog.length}-product catalog and the same {config.trends.length}-post trend feed for everyone. Only the persona changes.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-muted">Shoppers in this run</p>
          {config.personas.map((p) => {
            const on = selected.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                onClick={() => toggle(p.id)}
                aria-pressed={on}
                className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${on ? "border-ink bg-panel" : "border-line opacity-60"}`}
              >
                <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
                <span>
                  <span className="block font-display text-lg font-bold">{p.name}</span>
                  <span className="block text-sm text-ink-2">{p.tagline}</span>
                </span>
              </button>
            );
          })}
          <div className="mt-2 flex gap-3">
            {busy ? (
              <button type="button" onClick={exp.stop} className="rounded-full border border-ink px-6 py-3 font-medium">
                Stop run
              </button>
            ) : (
              <button
                type="button"
                disabled={selected.length < 2 || !objective.trim()}
                onClick={() => exp.run({ objective, budget, personaIds: selected })}
                className="rounded-full bg-ink px-6 py-3 font-medium text-[var(--base)] disabled:opacity-40"
              >
                {exp.results ? "Run again" : "Start shopping"}
              </button>
            )}
          </div>
          {selected.length < 2 && <p className="text-sm text-muted">Pick at least two shoppers to compare.</p>}
        </div>
      </section>

      <details className="mb-10 rounded-lg border border-line bg-panel px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">See the trend feed every agent reads</summary>
        <ul className="mt-3 grid gap-3 md:grid-cols-2">
          {config.trends.map((t) => (
            <li key={t.id} className="text-sm">
              <span className="font-medium">
                {t.platform}, {t.creator}
              </span>{" "}
              <span className="text-muted">({t.sentiment}, {t.engagement})</span>
              <p className="text-ink-2">{t.headline}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">Creators, ratings and engagement are simulated so every agent sees identical, controlled inputs.</p>
      </details>

      {exp.runError && <p className="mb-6 rounded-md border border-line bg-panel px-4 py-3 text-sm">The run stopped: {exp.runError}. Check the server log and your API key, then run again.</p>}

      {/* Lanes */}
      {activePersonas.length > 0 && (busy || exp.results) && (
        <section aria-label="Agent journeys" className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {activePersonas.map((p) => (
            <Lane key={p.id} persona={p} lane={exp.lanes[p.id]} budget={budget} />
          ))}
        </section>
      )}

      {exp.results && <Results trendIds={new Set(config.trends.flatMap((t) => t.productIds))} personas={config.personas} results={exp.results} judge={exp.judge} judgeError={exp.judgeError} judging={exp.phase === "judging"} budget={budget} objective={objective} />}
    </div>
  );
}

function Lane({ persona, lane, budget }: { persona: PublicPersona; lane?: LaneState; budget: number }) {
  const logRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lane?.log.length]);
  if (!lane) return null;
  const pct = Math.min(100, (lane.total / budget) * 100);
  const statusText = { idle: "Waiting", running: "Shopping", done: "Checked out", error: "Stopped" }[lane.status];

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-line bg-panel">
      <div className="h-1.5" style={{ background: persona.color }} aria-hidden />
      <header className="flex items-start justify-between gap-2 px-4 pt-3">
        <div>
          <h2 className="font-display text-xl font-bold">{persona.name}</h2>
          <p className="text-sm text-ink-2">{persona.decisionStyle}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
          {lane.status === "running" && <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: persona.color }} aria-hidden />}
          {statusText}
        </span>
      </header>

      <ol ref={logRef} className="mt-3 h-64 space-y-2 overflow-y-auto px-4 pb-3 text-sm" aria-live="polite" aria-label={`${persona.name} journey`}>
        {lane.log.length === 0 && lane.status === "running" && <li className="text-muted">Thinking about where to start…</li>}
        {lane.log.map((entry, i) =>
          entry.kind === "thought" ? (
            <li key={i} className="italic text-ink-2">
              {entry.text}
            </li>
          ) : (
            <li key={i} className="flex gap-2">
              <span className="w-4 shrink-0 text-center font-bold" style={{ color: persona.color }} aria-hidden>
                {TOOL_GLYPH[entry.tool ?? ""] ?? "·"}
              </span>
              <span>{entry.text}</span>
            </li>
          ),
        )}
        {lane.error && <li className="text-ink">Stopped: {lane.error}</li>}
      </ol>

      <div className="receipt mx-3 mb-3 mt-auto px-4 py-5">
        <div className="flex items-baseline justify-between">
          <span className="font-display font-bold">Receipt</span>
          <span className="tabular text-sm text-muted">
            {lane.items.length} item{lane.items.length === 1 ? "" : "s"}
          </span>
        </div>
        <ul className="mt-2">
          {lane.items.map((it) => (
            <li key={it.productId} className="receipt-row print-in py-2 text-sm">
              <div className="flex justify-between gap-3">
                <span>
                  <span className="font-medium">{it.brand}</span> {it.name}
                </span>
                <span className="tabular shrink-0">${it.price.toFixed(2)}</span>
              </div>
              <div className="mt-0.5 flex gap-2 text-xs text-muted">
                <span className="rounded-sm border border-line px-1">{INFLUENCE_LABEL[it.influence]}</span>
                <span className="line-clamp-2">{it.reason}</span>
              </div>
            </li>
          ))}
          {lane.items.length === 0 && <li className="py-2 text-sm text-muted">Nothing in the cart yet.</li>}
        </ul>
        <div className="mt-3 border-t-2 border-ink pt-2">
          <div className="flex justify-between font-display font-bold">
            <span>Total</span>
            <span className="tabular">${lane.total.toFixed(2)}</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-line" role="img" aria-label={`${Math.round(pct)}% of budget used`}>
            <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: persona.color }} />
          </div>
          <p className="tabular mt-1 text-xs text-muted">
            ${(budget - lane.total).toFixed(2)} left of ${budget}
          </p>
        </div>
        {lane.summary && <p className="mt-3 text-sm italic text-ink-2">“{lane.summary}”</p>}
      </div>
    </article>
  );
}
