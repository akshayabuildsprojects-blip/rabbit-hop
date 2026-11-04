import { useCallback, useEffect, useMemo, useState } from "react";
import type { PersonaConsistency } from "../../shared/consistency";
import type { AgentResult, BasketItem, JudgeResult, RunShopper, ShoppingMission } from "../../shared/types";
import { PRIORITY_LABEL } from "../../shared/scenarios";
import type { Experiment, LaneState, Step } from "./useExperiment";
import { BlindTab, JourneysTab, type Row } from "./ReportTabs";
import { ConsistencyTable } from "./ConsistencyTab";
import { api, jaccard, mainDriver, money, moneyRound } from "./lib";

interface StoreStatus {
  id: string;
  name: string;
  status: string;
}

interface SimSummary {
  id: string;
  scenario: string;
  budget: number | null;
  createdAt: string;
  updatedAt: string;
  shoppers: { id: string; name: string; color?: string; version: number | null }[];
  stores: StoreStatus[];
  repeats: number;
  runs: number;
  setup: {
    scenarioId: string | null;
    stores: string[];
    personas: { id: string; version: number | null }[];
    limit: { by: "steps" | "minutes"; steps?: number; minutes?: number };
    priorData?: Record<string, { source: "none" | "archetype" | "upload"; fileName?: string; rows?: number }>;
  } | null;
}

interface SavedRun {
  dir: string;
  store: string;
  runId: string;
  savedAt: string;
  cancelled?: boolean;
  mission: ShoppingMission;
  shoppers: RunShopper[];
  results: AgentResult[];
  judge: JudgeResult | null;
}

interface SimDetail extends SimSummary {
  runs: SavedRun[] & any;
  combos: { personaId: string; store: string; runs: { dir: string; runId: string; savedAt: string }[]; consistency: PersonaConsistency }[];
}

export type RepeatRequest = { simulationId: string; personaIds: string[]; stores: string[]; scenarioId: string; limit: { by: "steps" | "minutes"; steps?: number; minutes?: number } };

// Activity kinds in a saved run, mapped to the journey labels used in the live view.
const KIND_TOOL: Record<string, string> = {
  search: "page_search",
  product_view: "page_product",
  page_view: "page_view",
  click: "browser_click",
  type: "browser_type",
  keypress: "browser_keypress",
  scroll: "browser_scroll",
  drag: "browser_drag",
  compare: "compare_products",
  reject: "reject_product",
  add: "add_to_basket",
  remove: "remove_from_basket",
  read_page: "read_page",
  open_fallback: "open_link",
  new_tab: "open_in_new_tab",
  finish: "finalize_basket",
};

function stepsFromActivity(r: AgentResult): Step[] {
  const steps: Step[] = [];
  let thought: string | undefined;
  for (const a of r.activity ?? []) {
    if (a.kind === "thought") {
      thought = a.detail;
      continue;
    }
    const tool = KIND_TOOL[a.kind];
    if (!tool) continue;
    const text =
      a.kind === "search"
        ? `Searched "${a.detail}"`
        : a.kind === "product_view" || a.kind === "page_view"
          ? `Opened ${a.detail}`
          : a.kind === "add"
            ? `Added ${a.detail}`
            : a.kind === "reject"
              ? `Rejected ${a.detail}${a.reason ? `: ${a.reason}` : ""}`
              : a.kind === "compare"
                ? `Compared ${a.detail}${a.reason ? `: ${a.reason}` : ""}`
                : a.kind === "read_page"
                  ? "Read what is on screen"
                  : a.kind === "open_fallback"
                    ? "Opened a product link (fallback)"
                    : a.kind === "finish"
                      ? "Finished shopping"
                      : a.detail;
    steps.push({ tool, text, thought });
    thought = undefined;
  }
  return steps;
}

export function coverageOf(items: BasketItem[], list: ShoppingMission["shopping_list"], skipped?: { item: string; reason: string }[]) {
  return (list ?? []).map((li) => {
    const key = li.item.toLowerCase();
    const got = items.find((i) => (i.listItem ?? "").toLowerCase() === key) ?? items.find((i) => !i.listItem && i.name.toLowerCase().includes(key));
    const skip = skipped?.find((x) => x.item.toLowerCase().includes(key));
    return { item: li.item, priority: li.priority, got, skipped: got ? undefined : skip?.reason };
  });
}

function rowsFromSaved(run: SavedRun, only?: string): Row[] {
  return run.shoppers.filter((p) => !only || p.id === only).map((p) => {
    const r = run.results.find((x) => x.personaId === p.id);
    const items = r?.items ?? [];
    const total = r?.total ?? 0;
    const steps = r ? stepsFromActivity(r) : [];
    const lane: LaneState = { status: r?.error || r?.blocked ? "error" : "done", steps, items, total, summary: r?.summary ?? "", error: r?.error ?? (r?.blocked ? "Blocked by the site" : undefined) };
    return {
      p,
      lane,
      items,
      total,
      steps,
      stats: {
        searches: r?.stats.searches ?? 0,
        inspected: r?.stats.productsInspected ?? 0,
        trend: 0,
        alts: 0,
        clicks: r?.stats.clicks ?? 0,
        comparisons: r?.stats.comparisons ?? 0,
        rejections: r?.stats.rejections ?? 0,
        adds: items.length,
      },
      live: true,
      trendShare: 0,
      avgPrice: items.length ? total / items.length : 0,
      driver: mainDriver(items),
      summary: r?.summary ?? "",
      coverage: coverageOf(items, run.mission.shopping_list, r?.skipped),
      error: r?.error ?? (r?.blocked ? "Blocked by the site: the store refused to open pages for this automated session." : undefined),
    };
  });
}

// "Haus Labs Haus Labs Triclone…" -> "Haus Labs Triclone…" when the model repeats the brand in the name.
const label = (i: BasketItem) => (i.name.toLowerCase().startsWith(i.brand.toLowerCase()) ? i.name : `${i.brand} ${i.name}`);

const when = (iso: string) => {
  const d = new Date(iso);
  return isNaN(+d) ? iso : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

function download(name: string, data: unknown) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ResultsTab({ exp, openSim, onOpened, onRepeat }: { exp: Experiment; openSim: string | null; onOpened: () => void; onRepeat: (r: RepeatRequest) => void }) {
  const [list, setList] = useState<SimSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SimSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const busy = exp.phase === "shopping" || exp.phase === "judging";
  const runningSim = busy ? exp.meta?.simulationId : undefined;

  const refresh = useCallback(() => {
    api<{ simulations: SimSummary[] }>("/api/simulations")
      .then((r) => (setList(r.simulations), setError(null)))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => refresh(), [refresh, exp.phase]);
  useEffect(() => {
    if (openSim) {
      setOpen(openSim);
      onOpened();
    }
  }, [openSim, onOpened]);

  const doDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api(`/api/simulations/${encodeURIComponent(confirmDelete.id)}`, { method: "DELETE" });
      setConfirmDelete(null);
      if (open === confirmDelete.id) setOpen(null);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeleting(false);
    }
  };
  const doDownload = (id: string) => api(`/api/simulations/${encodeURIComponent(id)}`).then((d) => download(`persona-cart-lab-${id}.json`, d));

  const deleteDialog = confirmDelete && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !deleting && setConfirmDelete(null)}>
      <div role="dialog" aria-modal="true" aria-labelledby="del-title" className="card w-full max-w-[480px] bg-white p-6 text-sm" onClick={(e) => e.stopPropagation()}>
        <h3 id="del-title" className="text-xl font-black">
          Delete this simulation?
        </h3>
        <p className="mt-2">
          <span className="font-bold">{confirmDelete.scenario || "Untitled"}</span>, {confirmDelete.stores.map((s) => s.name.split(" (")[0]).join(" and ")}, {when(confirmDelete.updatedAt)}.
        </p>
        <p className="mt-2">This permanently removes all of its runs and repeats, on every store, with their records and screenshots, from this computer. It cannot be undone.</p>
        <div className="mt-5 flex justify-end gap-2.5">
          <button type="button" disabled={deleting} onClick={() => setConfirmDelete(null)} className="btn">
            Cancel
          </button>
          <button type="button" disabled={deleting} onClick={doDelete} className="btn btn-ink font-black">
            {deleting ? "Deleting…" : "Delete simulation"}
          </button>
        </div>
      </div>
    </div>
  );

  if (open) {
    const sum = list?.find((x) => x.id === open);
    return (
      <>
        <SimulationPage
          key={open + (busy ? "-live" : "")}
          id={open}
          running={runningSim === open}
          onBack={() => setOpen(null)}
          onDownload={() => doDownload(open)}
          onDelete={sum && runningSim !== open ? () => setConfirmDelete(sum) : undefined}
          onRepeat={onRepeat}
        />
        {deleteDialog}
      </>
    );
  }

  return (
    <>
      <p className="max-w-[72ch] text-ink-2">
        Each row is one simulation: one setup of shoppers, scenario, stores and limit, with every run and repeat that came from it. Open one to see the results per shopper and store, consistency across repeats and how each persona behaved on each store.
      </p>
      {error && <p className="box bg-sun px-4 py-3 text-sm font-semibold">Could not load results: {error}</p>}
      <div className="card overflow-hidden">
        {list === null && <p className="p-5 text-sm text-muted">Loading…</p>}
        {list && list.length === 0 && <p className="p-5 text-sm text-muted">No simulations yet. Run one from the Simulation page.</p>}
        {list?.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b-2 border-black px-5 py-4 last:border-b-0">
            <button type="button" onClick={() => setOpen(s.id)} className="flex min-w-0 flex-[1_1_380px] flex-col gap-1.5 text-left">
              <span className="font-extrabold leading-snug underline-offset-2 hover:underline">{s.scenario || "Untitled simulation"}</span>
              <span className="flex flex-wrap items-center gap-1.5">
                {s.shoppers.map((p) => (
                  <span key={p.id} className="tag bg-white">
                    <span className="swatch mr-1 h-2.5 w-2.5" style={{ background: p.color ?? "#ccc" }} />
                    {p.name}
                    {p.version ? ` v${p.version}` : ""}
                  </span>
                ))}
              </span>
              <span className="flex flex-wrap gap-x-3 text-[13px]">
                {s.stores.map((st) => (
                  <span key={st.id}>
                    <span className="font-bold">{st.name.split(" (")[0]}</span> {runningSim === s.id ? "running" : st.status}
                  </span>
                ))}
              </span>
            </button>
            <span className="text-sm text-ink-2">
              {s.repeats > 1 ? `${s.repeats} repeats` : "1 run"} · {when(s.updatedAt)}
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setOpen(s.id)} className="btn btn-raised min-h-10 px-3.5 py-1.5 text-[13px]">
                Open
              </button>
              <button type="button" onClick={() => doDownload(s.id)} className="btn min-h-10 px-3.5 py-1.5 text-[13px]">
                Download
              </button>
              {runningSim !== s.id && (
                <button type="button" onClick={() => setConfirmDelete(s)} className="btn min-h-10 px-3.5 py-1.5 text-[13px]">
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {deleteDialog}
    </>
  );
}

type Section = "overview" | "combination" | "blind" | "stores";

function SimulationPage({ id, running, onBack, onDownload, onDelete, onRepeat }: { id: string; running: boolean; onBack: () => void; onDownload: () => void; onDelete?: () => void; onRepeat: (r: RepeatRequest) => void }) {
  const [sim, setSim] = useState<SimDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [combo, setCombo] = useState<{ personaId: string; store: string } | null>(null);

  useEffect(() => {
    api<SimDetail>(`/api/simulations/${encodeURIComponent(id)}`)
      .then(setSim)
      .catch((e) => setErr(e.message));
  }, [id, running]);

  if (!sim)
    return (
      <div className="card p-6">
        <button type="button" onClick={onBack} className="text-sm font-bold underline">
          Back to results
        </button>
        <p className="mt-3 text-ink-2">{err ? `Could not load this simulation: ${err}` : "Loading…"}</p>
      </div>
    );

  const runs: SavedRun[] = sim.runs;
  const mission = runs[0]?.mission;
  const people = new Map<string, RunShopper>();
  for (const r of runs) for (const p of r.shoppers) people.set(p.id, p);
  const storeName = (s: string) => sim.stores.find((x) => x.id === s)?.name.split(" (")[0] ?? s;
  const multiStore = sim.stores.length > 1;
  const openCombo = (personaId: string, store: string) => {
    setCombo({ personaId, store });
    setSection("combination");
  };
  const canRepeat = !!sim.setup?.scenarioId && !running;
  const repeat = (personaIds: string[], stores: string[]) =>
    sim.setup && sim.setup.scenarioId && onRepeat({ simulationId: sim.id, personaIds, stores, scenarioId: sim.setup.scenarioId, limit: sim.setup.limit });

  const sections: { id: Section; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "combination", label: "Combination" },
    { id: "blind", label: "Blind test" },
    ...(multiStore ? [{ id: "stores" as Section, label: "Across stores" }] : []),
  ];

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <button type="button" onClick={onBack} className="self-start text-sm font-bold underline">
            Back to results
          </button>
          <h2 className="text-xl font-black">{mission?.objective}</h2>
          <span className="text-sm text-ink-2">
            Budget {money(mission?.budget ?? 0)}
            {mission?.shopping_list?.length ? `; list: ${mission.shopping_list.map((i) => `${i.item} (${PRIORITY_LABEL[i.priority].toLowerCase()})`).join(", ")}` : ""}
            {sim.setup ? `; limit ${sim.setup.limit.by === "steps" ? `${sim.setup.limit.steps} steps` : `${sim.setup.limit.minutes} min`}` : ""}
            ; stores: {sim.stores.map((s) => storeName(s.id)).join(", ")}
          </span>
          {sim.setup?.priorData && (
            <span className="text-sm text-ink-2">
              Prior data:{" "}
              {[...people.values()]
                .map((p) => {
                  const d = sim.setup!.priorData![p.id];
                  return `${p.name}, ${!d || d.source === "none" ? "none" : `${d.source === "archetype" ? "archetype history" : "uploaded"} ${d.fileName} (${d.rows} purchases)`}`;
                })
                .join("; ")}
            </span>
          )}
          {running && <span className="text-sm font-bold">Running now: results update when this run finishes.</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {canRepeat && (
            <button type="button" onClick={() => repeat([...people.keys()], sim.stores.map((s) => s.id))} className="btn btn-raised min-h-10 px-3.5 py-1.5 text-[13px]">
              Repeat all combinations
            </button>
          )}
          <button type="button" onClick={onDownload} className="btn min-h-10 px-3.5 py-1.5 text-[13px]">
            Download
          </button>
          {onDelete && (
            <button type="button" onClick={onDelete} className="btn min-h-10 px-3.5 py-1.5 text-[13px]">
              Delete
            </button>
          )}
        </div>
      </div>
      <div role="tablist" aria-label="Simulation sections" className="flex flex-wrap gap-2">
        {sections.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={section === s.id} onClick={() => setSection(s.id)} className={`btn min-h-10 px-4 py-1.5 ${section === s.id ? "bg-black text-white" : "btn-raised"}`}>
            {s.label}
          </button>
        ))}
      </div>

      {section === "overview" && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead>
              <tr className="border-b-2 border-black">
                <th className="px-4 py-2.5 font-extrabold">Persona</th>
                {sim.stores.map((s) => (
                  <th key={s.id} className="px-4 py-2.5 font-extrabold">
                    {storeName(s.id)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...people.values()].map((p) => (
                <tr key={p.id} className="border-b border-dashed border-black last:border-0">
                  <td className="px-4 py-3 font-bold">
                    <span className="swatch mr-2 h-3 w-3 align-middle" style={{ background: p.color }} />
                    {p.name}
                  </td>
                  {sim.stores.map((s) => {
                    const c = sim.combos.find((x) => x.personaId === p.id && x.store === s.id);
                    const lastRun = c ? runs.find((r) => r.dir === c.runs[c.runs.length - 1].dir) : undefined;
                    const res = lastRun?.results.find((x) => x.personaId === p.id);
                    return (
                      <td key={s.id} className="px-4 py-3 align-top">
                        {c ? (
                          <button type="button" onClick={() => openCombo(p.id, s.id)} className="flex flex-col gap-0.5 text-left">
                            <span className="font-bold underline-offset-2 hover:underline">
                              {c.runs.length} run{c.runs.length === 1 ? "" : "s"}
                              {c.consistency.runs >= 2 ? `, consistency ${Math.round(c.consistency.score * 100)}%` : ""}
                            </span>
                            <span className="text-[13px] text-ink-2">
                              Latest: {res?.error ? "stopped" : `${res?.items.length ?? 0} items, ${money(res?.total ?? 0)}`}
                            </span>
                          </button>
                        ) : (
                          <span className="text-muted">Not run</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {section === "combination" && (
        <CombinationView
          sim={sim}
          runs={runs}
          people={people}
          storeName={storeName}
          combo={combo ?? { personaId: [...people.keys()][0], store: sim.stores[0]?.id }}
          setCombo={setCombo}
          onRepeatOne={canRepeat ? (personaId, store) => repeat([personaId], [store]) : undefined}
        />
      )}

      {section === "blind" && <BlindSection runs={runs} storeName={storeName} />}

      {section === "stores" && <AcrossStores sim={sim} runs={runs} people={people} storeName={storeName} />}
    </>
  );
}

function Pick<T extends string>({ label, options, value, onChange, labelOf }: { label: string; options: T[]; value: T; onChange: (v: T) => void; labelOf: (v: T) => string }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={label}>
      <span className="text-[13px] font-bold">{label}</span>
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={o === value} onClick={() => onChange(o)} className={`chip min-h-9 ${o === value ? "bg-black text-white" : ""}`}>
          {labelOf(o)}
        </button>
      ))}
    </div>
  );
}

const PLAN_ENTRY: Record<string, string> = { search_box: "Search box", category_menu: "Category menus", bestsellers: "Best Sellers", new_arrivals: "New arrivals", sale: "Sale" };
const PLAN_STYLE: Record<string, string> = { generic_then_filter: "Generic, then filter", attribute_led: "By attributes", brand_or_product_known: "Brand or product it knows", mixed: "Mixed" };

// The plan the shopper made as the persona before browsing.
function PlanCard({ plan }: { plan: NonNullable<AgentResult["plan"]> }) {
  return (
    <div className="card flex flex-col gap-3 p-4 text-sm">
      <h4 className="font-black">Its plan before shopping</h4>
      <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[max-content_1fr]">
        <dt className="text-ink-2">Starts from</dt>
        <dd>
          <strong>{PLAN_ENTRY[plan.entry] ?? plan.entry}</strong>. {plan.entry_reason}
        </dd>
        <dt className="text-ink-2">Searches</dt>
        <dd>
          <strong>{PLAN_STYLE[plan.search_style] ?? plan.search_style}</strong>. {plan.style_reason}
        </dd>
      </dl>
      {plan.items.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {plan.items.map((i, n) => (
            <li key={n}>
              <strong>{i.list_item}</strong>: first {i.first_move}; needs to see {i.evidence_needed}; compares {i.options_to_compare}.
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CombinationView({
  sim,
  runs,
  people,
  storeName,
  combo,
  setCombo,
  onRepeatOne,
}: {
  sim: SimDetail;
  runs: SavedRun[];
  people: Map<string, RunShopper>;
  storeName: (s: string) => string;
  combo: { personaId: string; store: string };
  setCombo: (c: { personaId: string; store: string }) => void;
  onRepeatOne?: (personaId: string, store: string) => void;
}) {
  const [pick, setPick] = useState(0);
  const c = sim.combos.find((x) => x.personaId === combo.personaId && x.store === combo.store);
  const person = people.get(combo.personaId);
  const repeats = (c?.runs ?? []).map((ref) => runs.find((r) => r.dir === ref.dir)!).filter(Boolean);
  const rows = repeats.map((r) => rowsFromSaved(r, combo.personaId)[0]).filter(Boolean);
  const chosen = Math.min(pick, Math.max(0, rows.length - 1));
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2.5">
        <Pick label="Persona" options={[...people.keys()]} value={combo.personaId} onChange={(v) => (setCombo({ ...combo, personaId: v }), setPick(0))} labelOf={(v) => people.get(v)?.name ?? v} />
        <Pick label="Store" options={sim.stores.map((s) => s.id)} value={combo.store} onChange={(v) => (setCombo({ ...combo, store: v }), setPick(0))} labelOf={storeName} />
      </div>
      {!c ? (
        <p className="card p-5 text-sm">This persona has not run on this store in this simulation.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-2">
              {person?.name} on {storeName(combo.store)}: {rows.length} run{rows.length === 1 ? "" : "s"} under the same conditions.
            </p>
            {onRepeatOne && (
              <button type="button" onClick={() => onRepeatOne(combo.personaId, combo.store)} className="btn btn-raised min-h-10 px-3.5 py-1.5 text-[13px]">
                Repeat just this one
              </button>
            )}
          </div>
          <Summary rows={rows.map((r, i) => ({ ...r, p: { ...r.p, name: `Repeat ${i + 1}` } }))} judge={null} budget={repeats[0]?.mission.budget ?? 0} />
          <ConsistencyTable c={c.consistency} name={person?.name ?? ""} color={person?.color ?? "#ccc"} />
          <section className="flex flex-col gap-3">
            <h3 className="text-lg font-black">Journey</h3>
            {rows.length > 1 && <Pick label="Repeat" options={rows.map((_, i) => String(i))} value={String(chosen)} onChange={(v) => setPick(Number(v))} labelOf={(v) => `Repeat ${Number(v) + 1}`} />}
            {(() => {
              const plan = repeats[chosen]?.results.find((x) => x.personaId === combo.personaId)?.plan;
              return plan ? <PlanCard plan={plan} /> : null;
            })()}
            {rows[chosen] && <JourneysTab rows={[rows[chosen]]} pick={rows[chosen].p.id} setPick={() => {}} judge={null} />}
          </section>
        </>
      )}
    </div>
  );
}

function BlindSection({ runs, storeName }: { runs: SavedRun[]; storeName: (s: string) => string }) {
  const multi = runs.filter((r) => r.results.length >= 2);
  const [pick, setPick] = useState(multi.length ? multi[multi.length - 1].dir : "");
  const run = multi.find((r) => r.dir === pick);
  if (!multi.length)
    return (
      <div className="card p-5 text-sm">
        <span className="font-bold">The blind test needs two or more shoppers in the same run.</span> A judge sees the shuffled, unnamed results from one store and has to say which persona produced each.
      </div>
    );
  const byStore = (s: string) => multi.filter((r) => r.store === s);
  const labelOf = (dir: string) => {
    const r = multi.find((x) => x.dir === dir)!;
    return `${storeName(r.store)}, run ${byStore(r.store).indexOf(r) + 1}`;
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[75ch] text-sm text-ink-2">Do the personas behave differently from each other? For each store and run, a separate judge sees the shuffled, unnamed results and has to say which persona produced each one.</p>
      {multi.length > 1 && <Pick label="Store and run" options={multi.map((r) => r.dir)} value={pick} onChange={setPick} labelOf={labelOf} />}
      {run && <BlindTab rows={rowsFromSaved(run)} judge={run.judge} judgeError={null} phase="done" />}
    </div>
  );
}

function AcrossStores({ sim, runs, people, storeName }: { sim: SimDetail; runs: SavedRun[]; people: Map<string, RunShopper>; storeName: (s: string) => string }) {
  const [personaId, setPersonaId] = useState([...people.keys()][0]);
  const person = people.get(personaId);
  const latest = (store: string) => {
    const c = sim.combos.find((x) => x.personaId === personaId && x.store === store);
    if (!c) return null;
    const run = runs.find((r) => r.dir === c.runs[c.runs.length - 1].dir);
    const row = run ? rowsFromSaved(run, personaId)[0] : undefined;
    const sig = run?.results.find((x) => x.personaId === personaId)?.signature;
    return row ? { row, sig, runs: c.runs.length } : null;
  };
  const cols = sim.stores.map((s) => ({ store: s.id, data: latest(s.id) }));
  const list = runs[0]?.mission.shopping_list ?? [];
  const line = (label: string, f: (d: NonNullable<ReturnType<typeof latest>>) => string) => (
    <tr className="border-b border-dashed border-black last:border-0">
      <td className="px-4 py-2.5 font-bold">{label}</td>
      {cols.map((c) => (
        <td key={c.store} className="px-4 py-2.5 align-top">
          {c.data ? f(c.data) : "Not run"}
        </td>
      ))}
    </tr>
  );
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[75ch] text-sm text-ink-2">Does the persona behave the same way on a different store? Same scenario and limit; products differ because the stores carry different ranges. Shows each store's latest run.</p>
      <Pick label="Persona" options={[...people.keys()]} value={personaId} onChange={setPersonaId} labelOf={(v) => people.get(v)?.name ?? v} />
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead>
            <tr className="border-b-2 border-black" style={{ background: person?.color }}>
              <th className="px-4 py-2.5 font-extrabold">{person?.name}</th>
              {cols.map((c) => (
                <th key={c.store} className="px-4 py-2.5 font-extrabold">
                  {storeName(c.store)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((li) => (
              <tr key={li.item} className="border-b border-dashed border-black">
                <td className="px-4 py-2.5 font-bold">
                  {li.item} <span className="block text-xs font-normal text-muted">{PRIORITY_LABEL[li.priority]}</span>
                </td>
                {cols.map((c) => {
                  const cov = c.data?.row.coverage.find((x) => x.item === li.item);
                  return (
                    <td key={c.store} className="px-4 py-2.5 align-top">
                      {!c.data ? "Not run" : cov?.got ? `${label(cov.got)}, ${money(cov.got.price)}` : cov?.skipped ? `Skipped: ${cov.skipped}` : "Not bought"}
                    </td>
                  );
                })}
              </tr>
            ))}
            {line("Spend", (d) => money(d.row.total))}
            {line("Main decision driver", (d) => (d.row.items.length ? d.row.driver : "–"))}
            {line("How it entered the site", (d) => d.sig?.entry ?? "–")}
            {line("Sorting", (d) => d.sig?.sort ?? "–")}
            {line("Products viewed, comparisons, rejections", (d) => `${d.row.stats.inspected}, ${d.row.stats.comparisons}, ${d.row.stats.rejections}`)}
            {line("Runs on this store", (d) => String(d.runs))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Summary({ rows, judge, budget }: { rows: Row[]; judge: JudgeResult | null; budget: number }) {
  const ok = rows.filter((r) => !r.error && r.items.length);
  const low = ok.slice().sort((a, b) => a.total - b.total)[0];
  const high = ok.slice().sort((a, b) => b.total - a.total)[0];
  const headline = judge && !judge.simulated && judge.headline ? judge.headline : low && high && low !== high ? `${low.p.name} spent ${moneyRound(low.total)} and ${high.p.name} spent ${moneyRound(high.total)} on the same brief.` : "";
  return (
    <>
      {headline && <p className="card bg-sun px-5 py-4 text-lg font-bold leading-snug">{headline}</p>}
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
        {rows.map((r) => (
          <section key={r.p.id} className="card flex flex-col overflow-hidden" aria-label={r.p.name}>
            <div className="flex items-center justify-between gap-2 border-b-2 border-black px-4 py-3" style={{ background: r.p.color }}>
              <span className="font-black">{r.p.name}</span>
              <span className="mono font-semibold">
                {money(r.total)} <span className="text-xs font-normal">of {money(budget)}</span>
              </span>
            </div>
            <div className="flex flex-col gap-3 p-4 text-sm">
              {r.error && <p className="font-semibold">Stopped: {r.error}</p>}
              {r.coverage.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {r.coverage.map((c) => (
                    <li key={c.item} className="flex flex-col gap-0.5">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-bold">
                          {c.got ? "✓" : "✗"} {c.item}
                        </span>
                        <span className="text-xs text-muted">{PRIORITY_LABEL[c.priority]}</span>
                      </span>
                      <span className="text-[13px] text-ink-2">
                        {c.got ? (
                          <>
                            {label(c.got)}, {money(c.got.price)}
                            {c.got.evidence && c.got.evidence !== "product page" && <span className="ml-1 text-xs font-bold">(decided from {c.got.evidence === "quicklook" ? "Quicklook" : c.got.evidence === "new tab" ? "a new tab" : "the results tile"})</span>}
                            {c.got.reason && <span className="block italic">“{c.got.reason}”</span>}
                          </>
                        ) : c.skipped ? (
                          `Skipped: ${c.skipped}`
                        ) : (
                          "Not bought"
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <dl className="grid grid-cols-3 gap-2 border-t-2 border-dashed border-black pt-3 text-center">
                {[
                  ["Avg price", r.items.length ? moneyRound(r.avgPrice) : "–"],
                  ["Viewed", r.stats.inspected],
                  ["Compared", r.stats.comparisons],
                  ["Rejected", r.stats.rejections],
                  ["Searches", r.stats.searches],
                  ["Driver", r.items.length ? r.driver : "–"],
                ].map(([k, v]) => (
                  <div key={String(k)} className="flex flex-col">
                    <dd className="mono text-lg font-semibold">{v}</dd>
                    <dt className="text-xs text-muted">{k}</dt>
                  </div>
                ))}
              </dl>
              {r.summary && <p className="border-t-2 border-dashed border-black pt-3 italic">“{r.summary}”</p>}
            </div>
          </section>
        ))}
      </div>
      {rows.length > 1 && (
        <section className="card px-5 py-4" aria-label="Cart overlap">
          <h3 className="font-black">Cart overlap</h3>
          <p className="text-[13px] text-muted">Share of products two shoppers both bought. Lower means more distinct behavior.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {rows.flatMap((a, i) =>
              rows.slice(i + 1).map((b) => (
                <span key={a.p.id + b.p.id} className="box px-3 py-2 text-sm">
                  {a.p.name} and {b.p.name}: <span className="mono font-semibold">{Math.round(jaccard(a.items, b.items) * 100)}%</span>
                </span>
              )),
            )}
          </div>
        </section>
      )}
    </>
  );
}
