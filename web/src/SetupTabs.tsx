import type { Category, ConsumerContext } from "../../shared/types";
import { PRIORITY_LABEL, type Priority, type Scenario } from "../../shared/scenarios";
import type { Experiment } from "./useExperiment";
import { colorOf, money, TOOL_TAG, type AppConfig, type LibraryEntry } from "./lib";

export const CATEGORIES: Category[] = ["cleanser", "serum", "moisturizer", "sunscreen", "lip", "complexion", "cheek", "eyes", "body"];

export interface MissionDraft {
  environment: "sandbox" | "sephora";
  objective: string;
  budget: number;
  product_categories: Category[];
  occasion: string;
}

interface ExperimentProps {
  config: AppConfig;
  library: LibraryEntry[];
  selected: string[];
  setSelected: (ids: string[]) => void;
  mission: MissionDraft;
  setMission: (m: MissionDraft) => void;
  context: ConsumerContext;
  setContext: (c: ConsumerContext) => void;
  exp: Experiment;
  onRun: () => void;
  onOpenJourney: (personaId: string) => void;
  onOpenLibrary: () => void;
}

const fieldLabel = "text-[13px] font-bold";

// Full mission and consumer-context editor. Not shown in the MVP; kept for later.
export function AdvancedExperimentTab({ config, library, selected, setSelected, mission, setMission, context, setContext, exp, onRun, onOpenJourney, onOpenLibrary }: ExperimentProps) {
  const busy = exp.phase === "shopping" || exp.phase === "judging";
  const runPersonas = exp.setup?.personas ?? [];
  const live = mission.environment === "sephora";
  const minShoppers = live ? 1 : 2;
  const canRun = selected.length >= minShoppers && mission.objective.trim().length > 0 && !busy && (!live || config.mode === "live");
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const provisional = library.filter((e) => selected.includes(e.persona_id) && e.lockedVersion === null);

  return (
    <>
      <div className="flex flex-wrap items-start gap-6">
        {/* Shopping mission */}
        <section className="card flex min-w-0 flex-[2_1_460px] flex-col gap-5 p-6" aria-labelledby="mission-h">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="mission-h" className="text-[15px] font-black tracking-wide">
              SHOPPING MISSION
            </h2>
            <span className="text-xs text-muted">Shared by every shopper.</span>
          </div>
          <fieldset className="flex flex-col gap-2" disabled={busy}>
            <legend className={`${fieldLabel} mb-2`}>Where they shop</legend>
            <div className="flex flex-wrap gap-2.5">
              {(
                [
                  { id: "sandbox", label: "Demo store", note: `${config.catalog.length} curated Sephora products, simulated reviews and buzz. Fast, all shoppers at once.` },
                  { id: "sephora", label: "Sephora.com (live)", note: "Muse Spark browses the real site in a Chrome window on this computer, one shopper at a time, about 10 minutes each. No sign-in, no checkout." },
                ] as const
              ).map((o) => {
                const on = mission.environment === o.id;
                return (
                  <button key={o.id} type="button" aria-pressed={on} onClick={() => setMission({ ...mission, environment: o.id })} className={`box flex max-w-[340px] flex-1 flex-col gap-1 p-3 text-left ${on ? "bg-black text-white" : ""}`}>
                    <span className="font-black">{o.label}</span>
                    <span className={`text-[13px] ${on ? "text-white/80" : "text-muted"}`}>{o.note}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="flex flex-col gap-2">
            <label htmlFor="goal" className={fieldLabel}>
              Objective
            </label>
            <textarea id="goal" rows={2} maxLength={400} value={mission.objective} disabled={busy} onChange={(e) => setMission({ ...mission, objective: e.target.value })} className="field resize-none text-xl font-extrabold leading-tight" />
          </div>
          <div className="flex flex-wrap gap-6">
            <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-2">
              <label htmlFor="budget" className={fieldLabel}>
                Budget per shopper
              </label>
              <div className="flex items-center gap-4">
                <span className="mono min-w-[4ch] text-3xl font-semibold">${mission.budget}</span>
                <input id="budget" type="range" min={40} max={500} step={10} value={mission.budget} disabled={busy} onChange={(e) => setMission({ ...mission, budget: Number(e.target.value) })} className="flex-1" />
              </div>
            </div>
            <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-2">
              <label htmlFor="occasion" className={fieldLabel}>
                Occasion <span className="font-normal text-muted">(optional)</span>
              </label>
              <input id="occasion" className="field" maxLength={120} disabled={busy} placeholder="e.g. holiday party, weekend away" value={mission.occasion} onChange={(e) => setMission({ ...mission, occasion: e.target.value })} />
            </div>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className={`${fieldLabel} mb-2`}>
              Product categories <span className="font-normal text-muted">(none selected means any)</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => {
                const on = mission.product_categories.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={busy}
                    aria-pressed={on}
                    onClick={() => setMission({ ...mission, product_categories: on ? mission.product_categories.filter((x) => x !== c) : [...mission.product_categories, c] })}
                    className={`chip min-h-9 capitalize ${on ? "bg-black text-white" : ""}`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </section>

        {/* Consumer context */}
        <section className="box flex min-w-0 flex-[1_1_300px] flex-col gap-4 bg-lilac p-5" aria-labelledby="ctx-h">
          <div>
            <h2 id="ctx-h" className="text-[15px] font-black tracking-wide">
              CONSUMER CONTEXT
            </h2>
            <p className="mt-1 text-xs text-ink-2">Who they are shopping as today. Applied to every shopper for this run only; never saved into a persona.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="country" className={fieldLabel}>
                Country
              </label>
              <input id="country" className="field" maxLength={60} disabled={busy} placeholder="e.g. Singapore" value={context.country ?? ""} onChange={(e) => setContext({ ...context, country: e.target.value || undefined })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="city" className={fieldLabel}>
                City
              </label>
              <input id="city" className="field" maxLength={60} disabled={busy} value={context.city ?? ""} onChange={(e) => setContext({ ...context, city: e.target.value || undefined })} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="income" className={fieldLabel}>
              Disposable income
            </label>
            <select id="income" className="field" disabled={busy} value={context.disposable_income ?? ""} onChange={(e) => setContext({ ...context, disposable_income: (e.target.value || undefined) as ConsumerContext["disposable_income"] })}>
              <option value="">Not specified</option>
              <option value="low">Low</option>
              <option value="middle">Middle</option>
              <option value="high">High</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="req" className={fieldLabel}>
              Personal requirements
            </label>
            <input id="req" className="field" maxLength={400} disabled={busy} placeholder="e.g. fragrance-free, oily skin" value={context.personal_requirements ?? ""} onChange={(e) => setContext({ ...context, personal_requirements: e.target.value || undefined })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="life" className={fieldLabel}>
              Lifestyle
            </label>
            <input id="life" className="field" maxLength={400} disabled={busy} placeholder="e.g. long commute, gym most days" value={context.lifestyle ?? ""} onChange={(e) => setContext({ ...context, lifestyle: e.target.value || undefined })} />
          </div>
        </section>
      </div>

      {/* Shoppers */}
      <section className="card flex flex-col gap-4 p-6" aria-labelledby="shoppers-h">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="shoppers-h" className="text-[15px] font-black tracking-wide">
            SHOPPERS IN THIS RUN
          </h2>
          <button type="button" onClick={onOpenLibrary} className="text-[13px] font-bold underline">
            Manage personas
          </button>
        </div>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
          {library.map((e) => {
            const on = selected.includes(e.persona_id);
            return (
              <button
                key={e.persona_id}
                type="button"
                disabled={busy}
                aria-pressed={on}
                onClick={() => toggle(e.persona_id)}
                className={`flex flex-col gap-2 rounded-md border-2 border-black bg-white p-3.5 text-left ${on ? "shadow-[4px_4px_0_#000]" : "opacity-55"}`}
              >
                <span className="flex items-center gap-2 text-sm font-extrabold leading-tight">
                  <span className="swatch" style={{ background: colorOf(e) }} />
                  {e.persona_name}
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className={`tag ${e.lockedVersion ? "bg-black text-white" : "bg-white"}`}>{e.lockedVersion ? `LOCKED V${e.lockedVersion}` : "PROVISIONAL"}</span>
                  <span className="text-xs font-bold">{on ? "In run" : "Off"}</span>
                </span>
              </button>
            );
          })}
        </div>
        {provisional.length > 0 && (
          <p className="text-[13px] text-ink-2">
            {provisional.map((p) => p.persona_name).join(", ")} {provisional.length === 1 ? "has" : "have"} no locked profile yet, so {provisional.length === 1 ? "it shops" : "they shop"} from the provisional
            definition. Research and lock {provisional.length === 1 ? "it" : "them"} in Personas for evidence-based behavior.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {busy ? (
            <button type="button" onClick={exp.stop} className="btn btn-raised">
              Stop run
            </button>
          ) : (
            <button type="button" onClick={onRun} disabled={!canRun} className="btn btn-sun btn-raised px-6 py-3.5 text-base font-black">
              {exp.results ? "Run again" : "Run experiment"}
            </button>
          )}
          <span className="text-sm text-muted">
            {selected.length < minShoppers
              ? "Pick at least two shoppers to compare."
              : live && config.mode !== "live"
                ? "Shopping on Sephora.com needs MODEL_API_KEY."
                : live
                  ? `${selected.length} shopper${selected.length === 1 ? "" : "s"} will browse Sephora.com one after another, about ${selected.length * 10} minutes in total.${selected.length === 1 ? " The blind test needs two or more." : ""}`
                  : config.mode === "live"
                    ? `Agents run live on ${config.model}.`
                    : "Simulation mode: add MODEL_API_KEY to run on Muse Spark."}
          </span>
        </div>
        {exp.runError && (
          <p role="alert" className="box bg-sun px-4 py-3 text-sm font-semibold">
            The run stopped: {exp.runError}
          </p>
        )}
      </section>

      {runPersonas.length > 0 && (
        <section aria-label="Live run" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-black">{busy ? (exp.phase === "judging" ? "Agents checked out. The judge is reading the carts." : "Agents are shopping") : "Last run"}</h2>
            {busy && <span className="text-sm text-muted">Open a shopper to watch every step.</span>}
          </div>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
            {runPersonas.map((p) => {
              const lane = exp.lanes[p.id];
              const last = lane?.steps[lane.steps.length - 1];
              const pct = Math.min(100, ((lane?.total ?? 0) / (exp.setup?.budget ?? mission.budget)) * 100);
              const status = { idle: "Waiting", running: "Shopping", done: "Checked out", error: "Stopped" }[lane?.status ?? "idle"];
              return (
                <button key={p.id} type="button" onClick={() => onOpenJourney(p.id)} className="box flex flex-col gap-2.5 p-4 text-left hover:shadow-[4px_4px_0_#000]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 font-extrabold">
                      <span className="swatch" style={{ background: p.color }} />
                      <span className="truncate">{p.name}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-xs font-bold">
                      {lane?.status === "running" && <span className="h-2 w-2 animate-pulse rounded-full bg-black" aria-hidden />}
                      {status}
                    </span>
                  </div>
                  <p className="min-h-10 text-[13px] leading-snug text-ink-2">
                    {last ? (
                      <>
                        <span className="tag mr-1.5" style={{ background: TOOL_TAG[last.tool]?.bg, color: TOOL_TAG[last.tool]?.fg }}>
                          {TOOL_TAG[last.tool]?.label ?? "STEP"}
                        </span>
                        {last.text}
                      </>
                    ) : lane?.error ? (
                      `Stopped: ${lane.error}`
                    ) : (
                      "Thinking about where to start…"
                    )}
                  </p>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-bold">{lane?.items.length ?? 0} items</span>
                    <span className="mono font-semibold">{money(lane?.total ?? 0)}</span>
                  </div>
                  <span className="block h-2.5 rounded-sm border-2 border-black bg-wash">
                    <span className="block h-full transition-[width] duration-300" style={{ width: `${pct}%`, background: p.color }} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

/* ================= MVP: scenarios and the simple run page ================= */

const PRIORITY_STYLE: Record<Priority, string> = {
  must: "bg-black text-white",
  preferred: "bg-sun",
  nice: "bg-white",
};

export function ScenarioList({ scenario }: { scenario: Scenario }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {scenario.items.map((i, n) => (
        <li key={i.item} className="flex items-center justify-between gap-3 text-sm">
          <span className="font-bold">
            <span className="mono mr-2 text-muted">{n + 1}</span>
            {i.item}
          </span>
          <span className={`tag ${PRIORITY_STYLE[i.priority]}`}>{PRIORITY_LABEL[i.priority]}</span>
        </li>
      ))}
    </ol>
  );
}

export function ScenariosTab({ config, scenarioId, onUse }: { config: AppConfig; scenarioId: string; onUse: (id: string) => void }) {
  return (
    <>
      <p className="max-w-[70ch] text-ink-2">
        A scenario is the brief every shopper in a run receives: why they are shopping, the budget, and a shopping list in priority order. Each shopper works through the list top-down. A must-have has to be bought or explained, and nothing outside the list is bought.
      </p>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
        {config.scenarios.map((s) => {
          const on = s.id === scenarioId;
          return (
            <section key={s.id} className={`card flex flex-col gap-4 p-5 ${on ? "ring-4 ring-black" : ""}`} aria-labelledby={`sc-${s.id}`}>
              <div className="flex items-baseline justify-between gap-3">
                <h2 id={`sc-${s.id}`} className="text-xl font-black">
                  {s.title}
                </h2>
                <span className="mono text-2xl font-semibold">${s.budget}</span>
              </div>
              <p className="text-sm leading-relaxed">{s.why}</p>
              <ScenarioList scenario={s} />
              <button type="button" onClick={() => onUse(s.id)} className={`btn mt-auto ${on ? "btn-ink" : "btn-raised"}`}>
                {on ? "Selected for the next run" : "Use in a run"}
              </button>
            </section>
          );
        })}
      </div>
    </>
  );
}

interface RunProps {
  config: AppConfig;
  library: LibraryEntry[];
  selected: string[];
  setSelected: (ids: string[]) => void;
  scenarioId: string;
  setScenarioId: (id: string) => void;
  limit: RunLimit;
  setLimit: (l: RunLimit) => void;
  canRepeat: boolean;
  stores: string[];
  setStores: (s: string[]) => void;
  queue: { current: number; total: number; store: string } | null;
  onStop: () => void;
  iteration: number | null;
  onRunAgain: () => void;
  exp: Experiment;
  onRun: () => void;
  onOpenJourney: (personaId: string) => void;
  onOpenLibrary: () => void;
}

export interface RunLimit {
  by: "steps" | "minutes";
  steps: number;
  minutes: number;
}

export function ExperimentTab({ config, library, selected, setSelected, scenarioId, setScenarioId, limit, setLimit, canRepeat, stores, setStores, queue, onStop, iteration, onRunAgain, exp, onRun, onOpenJourney, onOpenLibrary }: RunProps) {
  const busy = exp.phase === "shopping" || exp.phase === "judging" || !!queue;
  const runPersonas = exp.setup?.personas ?? [];
  const scenario = config.scenarios.find((s) => s.id === scenarioId) ?? config.scenarios[0];
  const storeName = (id: string) => config.retailers.find((r) => r.id === id)?.name ?? id;
  const toggleStore = (id: string) => setStores(stores.includes(id) ? stores.filter((x) => x !== id) : [...stores, id]);
  const live = config.mode === "live";
  const lockedIds = new Set(library.filter((e) => e.lockedVersion !== null).map((e) => e.persona_id));
  const chosen = selected.filter((id) => lockedIds.has(id));
  const canRun = chosen.length >= 1 && stores.length >= 1 && !!scenario && live && !busy;
  const toggle = (id: string) => {
    if (!lockedIds.has(id)) return;
    setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  return (
    <>
      <div className="flex flex-wrap items-start gap-6">
        <section className="card flex min-w-0 flex-[1_1_380px] flex-col gap-4 p-6" aria-labelledby="pick-shoppers">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="pick-shoppers" className="text-[15px] font-black tracking-wide">
              1. CHOOSE SHOPPERS
            </h2>
            <button type="button" onClick={onOpenLibrary} className="text-[13px] font-bold underline">
              Manage personas
            </button>
          </div>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
            {library.map((e) => {
              const locked = e.lockedVersion !== null;
              const on = locked && selected.includes(e.persona_id);
              return (
                <button
                  key={e.persona_id}
                  type="button"
                  disabled={busy || !locked}
                  aria-pressed={on}
                  onClick={() => toggle(e.persona_id)}
                  title={locked ? undefined : "Approve and lock this persona in Personas to use it"}
                  className={`flex flex-col gap-2 rounded-md border-2 border-black bg-white p-3.5 text-left ${on ? "shadow-[4px_4px_0_#000]" : "opacity-55"} ${locked ? "" : "cursor-not-allowed border-dashed"}`}
                >
                  <span className="flex items-center gap-2 text-sm font-extrabold leading-tight">
                    <span className="swatch" style={{ background: colorOf(e) }} />
                    {e.persona_name}
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className={`tag ${locked ? "bg-black text-white" : "bg-white"}`}>{locked ? `LOCKED V${e.lockedVersion}` : "NOT LOCKED"}</span>
                    <span className="text-xs font-bold">{!locked ? "Unavailable" : on ? "In run" : "Off"}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-[13px] text-ink-2">
            {lockedIds.size === 0 ? "No persona is approved and locked yet. " : ""}Only approved and locked personas can run a scenario, so every result traces back to a fixed, versioned profile.{" "}
            <button type="button" onClick={onOpenLibrary} className="font-bold underline">
              Review and lock personas
            </button>
          </p>
        </section>

        <section className="card flex min-w-0 flex-[1_1_380px] flex-col gap-4 p-6" aria-labelledby="pick-scenario">
          <h2 id="pick-scenario" className="text-[15px] font-black tracking-wide">
            2. CHOOSE A SCENARIO
          </h2>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Scenario">
            {config.scenarios.map((s) => {
              const on = s.id === scenario?.id;
              return (
                <button key={s.id} type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => setScenarioId(s.id)} className={`chip min-h-10 ${on ? "bg-black text-white" : ""}`}>
                  {s.title}
                </button>
              );
            })}
          </div>
          {scenario && (
            <div className="box flex flex-col gap-3 bg-lilac p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm leading-snug">{scenario.why}</span>
                <span className="mono text-2xl font-semibold">${scenario.budget}</span>
              </div>
              <ScenarioList scenario={scenario} />
            </div>
          )}
        </section>
      </div>

      <section className="card flex flex-col gap-3 p-6" aria-labelledby="store-h">
        <h2 id="store-h" className="text-[15px] font-black tracking-wide">
          3. WHERE THEY SHOP
        </h2>
        <div className="flex flex-wrap gap-3">
          {config.retailers.map((r) => {
            const on = stores.includes(r.id);
            return (
              <button key={r.id} type="button" aria-pressed={on} disabled={busy} onClick={() => toggleStore(r.id)} className={`flex min-w-[220px] flex-col gap-1 rounded-md border-2 border-black bg-white p-3.5 text-left ${on ? "shadow-[4px_4px_0_#000]" : "opacity-55"}`}>
                <span className="font-extrabold">{r.name}</span>
                <span className="text-xs font-bold">{on ? "Included" : "Off"}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[13px] text-ink-2">
          {stores.length > 1
            ? `Each shopper shops ${stores.map(storeName).join(", then ")}. Each store is saved as its own result, with its own blind test.`
            : "Choose one or more stores. Persona research covered Sephora and Ulta; on other stores shoppers use their core behavior without store-specific findings."}
        </p>
      </section>

      <section className="card flex flex-col gap-3 p-6" aria-labelledby="dur-h">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="dur-h" className="text-[15px] font-black tracking-wide">
            4. LIMIT PER SHOPPER
          </h2>
          <div className="flex gap-2" role="radiogroup" aria-label="Limit by">
            {(["steps", "minutes"] as const).map((b) => (
              <button key={b} type="button" role="radio" aria-checked={limit.by === b} disabled={busy} onClick={() => setLimit({ ...limit, by: b })} className={`chip min-h-9 ${limit.by === b ? "bg-black text-white" : ""}`}>
                {b === "steps" ? "Steps" : "Minutes"}
              </button>
            ))}
          </div>
        </div>
        {limit.by === "steps" ? (
          <div className="flex flex-wrap items-center gap-4">
            <label htmlFor="steps" className="sr-only">
              Steps per shopper
            </label>
            <span className="mono min-w-[6ch] text-3xl font-semibold">{limit.steps}</span>
            <input id="steps" type="range" min={10} max={60} step={5} value={limit.steps} disabled={busy} onChange={(e) => setLimit({ ...limit, steps: Number(e.target.value) })} className="min-w-[200px] flex-1" />
            <span className="max-w-[48ch] text-sm text-muted">
              steps per shopper. A step is one look at the page and one decision about what to do next. Steps keep runs comparable: every shopper gets the same number, however fast the site is. Safety cap: 20 minutes.
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <label htmlFor="minutes" className="sr-only">
              Minutes per shopper
            </label>
            <span className="mono min-w-[6ch] text-3xl font-semibold">{limit.minutes} min</span>
            <input id="minutes" type="range" min={1} max={20} step={1} value={limit.minutes} disabled={busy} onChange={(e) => setLimit({ ...limit, minutes: Number(e.target.value) })} className="min-w-[200px] flex-1" />
            <span className="max-w-[48ch] text-sm text-muted">
              per shopper{chosen.length > 1 ? `; ${chosen.length} shoppers × ${limit.minutes} min = up to ${chosen.length * limit.minutes} min in total` : ""}. Slow pages mean fewer steps, so time limits make runs less comparable.
            </span>
          </div>
        )}
        <p className="text-[13px] text-ink-2">Near the limit the shopper is told to decide. At the limit it stops browsing and records its summary and any skipped list items.</p>
      </section>

      <section className="card flex flex-col gap-3 p-6" aria-labelledby="run-h">
        <h2 id="run-h" className="text-[15px] font-black tracking-wide">
          5. RUN
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          {busy ? (
            <button type="button" onClick={onStop} className="btn btn-raised">
              Stop
            </button>
          ) : (
            <>
              <button type="button" onClick={onRun} disabled={!canRun} className="btn btn-sun btn-raised px-6 py-3.5 text-base font-black">
                {stores.length === 1 ? `Send shoppers to ${storeName(stores[0]).split(" (")[0]}` : "Send shoppers to both stores"}
              </button>
              {canRepeat && (
                <button type="button" onClick={onRunAgain} disabled={!canRun} className="btn btn-raised px-5 py-3.5 font-black">
                  Run again with the same setup
                </button>
              )}
            </>
          )}
          <span className="text-sm text-muted">
            {!live
              ? "Live shopping needs MODEL_API_KEY."
              : chosen.length === 0
                ? "Choose at least one locked persona."
                : stores.length === 0
                  ? "Choose at least one store."
                  : queue
                    ? `Running store ${queue.current} of ${queue.total}: ${storeName(queue.store)}.`
                    : `Shoppers browse in a Chrome window on this computer, one after another${stores.length > 1 ? ", store by store" : ""}. No sign-in, no checkout.${chosen.length === 1 ? " Choose two or more for the blind test." : ""}`}
          </span>
        </div>
        {canRepeat && !busy && (
          <p className="text-[13px] text-ink-2">
            "Run again with the same setup" repeats every persona and store combination under exactly the same conditions, inside the same simulation. In Results, each combination then shows its repeats side by side and how consistent it was. You can also repeat a single combination from its page in Results. Changing anything above starts a new simulation.
          </p>
        )}
        {exp.runError && (
          <p role="alert" className="box bg-sun px-4 py-3 text-sm font-semibold">
            The run stopped: {exp.runError}
          </p>
        )}
      </section>

      {runPersonas.length > 0 && (
        <section aria-label="Run progress" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-black">{busy ? (exp.phase === "judging" ? "Shoppers finished. The judges are reading the results." : `Shoppers are on ${storeName(exp.setup?.environment ?? "").split(" (")[0]}`) : "Last run"}</h2>
            {busy && <span className="text-sm text-muted">Open a shopper to watch every step.</span>}
          </div>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
            {runPersonas.map((p) => {
              const lane = exp.lanes[p.id];
              const last = lane?.steps[lane.steps.length - 1];
              const pct = Math.min(100, ((lane?.total ?? 0) / (exp.setup?.budget ?? scenario?.budget ?? 100)) * 100);
              const status = { idle: "Waiting", running: "Shopping", done: "Finished", error: "Stopped" }[lane?.status ?? "idle"];
              return (
                <button key={p.id} type="button" onClick={() => onOpenJourney(p.id)} className="box flex flex-col gap-2.5 p-4 text-left hover:shadow-[4px_4px_0_#000]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 font-extrabold">
                      <span className="swatch" style={{ background: p.color }} />
                      <span className="truncate">{p.name}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-xs font-bold">
                      {lane?.status === "running" && <span className="h-2 w-2 animate-pulse rounded-full bg-black" aria-hidden />}
                      {lane ? status : "Waiting"}
                    </span>
                  </div>
                  <p className="min-h-10 text-[13px] leading-snug text-ink-2">
                    {last ? (
                      <>
                        <span className="tag mr-1.5" style={{ background: TOOL_TAG[last.tool]?.bg, color: TOOL_TAG[last.tool]?.fg }}>
                          {TOOL_TAG[last.tool]?.label ?? "STEP"}
                        </span>
                        {last.text}
                      </>
                    ) : lane?.error ? (
                      `Stopped: ${lane.error}`
                    ) : (
                      "Waiting for its turn…"
                    )}
                  </p>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-bold">{lane?.items.length ?? 0} items</span>
                    <span className="mono font-semibold">{money(lane?.total ?? 0)}</span>
                  </div>
                  <span className="block h-2.5 rounded-sm border-2 border-black bg-wash">
                    <span className="block h-full transition-[width] duration-300" style={{ width: `${pct}%`, background: p.color }} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
