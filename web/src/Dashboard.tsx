import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RunShopper } from "../../shared/types";
import { useExperiment } from "./useExperiment";
import { CartIcon } from "./Public";
import { ExperimentTab, ScenariosTab, type PriorState, type RunLimit } from "./SetupTabs";
import type { PriorChoice } from "../../shared/priorData";
import { ResultsTab, type RepeatRequest } from "./ResultsTab";
import { PersonaLibrary } from "./PersonaLibrary";
import { api, colorOf, type AppConfig, type LibraryEntry } from "./lib";

type Tab = "personas" | "scenarios" | "experiment" | "results";

const NAV: { id: Tab; label: string; group: "setup" | "report" }[] = [
  { id: "personas", label: "Personas", group: "setup" },
  { id: "scenarios", label: "Scenarios", group: "setup" },
  { id: "experiment", label: "Simulation", group: "setup" },
  { id: "results", label: "Results", group: "report" },
];

export function Dashboard({ config, user, onLogout }: { config: AppConfig; user: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("personas");
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [selected, setSelected] = useState<string[]>(() => ["trend-driven", "price-sensitive", "luxury"].filter((id) => config.archetypes.some((a) => a.persona_id === id)));
  const [scenarioId, setScenarioId] = useState<string>(config.scenarios[0]?.id ?? "");
  const [limit, setLimit] = useState<RunLimit>({ by: "steps", steps: 30, minutes: 5 });
  const scenario = config.scenarios.find((s) => s.id === scenarioId) ?? config.scenarios[0];
  const [journey, setJourney] = useState("");
  const budget = scenario?.budget ?? 100;
  const refreshLibrary = useCallback(() => {
    api<{ personas: LibraryEntry[] }>("/api/personas")
      .then((r) => setLibrary(r.personas))
      .catch(() => {});
  }, []);
  useEffect(() => refreshLibrary(), [refreshLibrary]);
  const exp = useExperiment();
  const runBudget = exp.setup?.budget ?? budget;
  const busy = exp.phase === "shopping" || exp.phase === "judging";
  const isReport = NAV.find((n) => n.id === tab)?.group === "report";

  // Stores to shop. With more than one, each store gets its own run, one after another,
  // all inside one simulation (one setup), so Results shows them together.
  const [stores, setStores] = useState<string[]>(["sephora"]);
  const [queue, setQueue] = useState<{ current: number; total: number; store: string } | null>(null);
  const [openSim, setOpenSim] = useState<string | null>(null);
  const cancelled = useRef(false);
  // Prior data per shopper. Shoppers with a built-in archetype history use it unless set otherwise.
  const [priorFiles, setPriorFiles] = useState<{ personaId: string; fileName: string; rows: number }[]>([]);
  const [priorPick, setPriorPick] = useState<Record<string, PriorState>>({});
  const [usePrior, setUsePrior] = useState(false);
  useEffect(() => {
    api<{ personaId: string; fileName: string; rows: number }[]>("/api/prior-data")
      .then(setPriorFiles)
      .catch(() => {});
  }, []);
  // When prior data is on, each shopper uses its existing file unless a new one is attached.
  const priorOf = (id: string): PriorState => priorPick[id] ?? (priorFiles.some((f) => f.personaId === id) ? { source: "archetype" } : { source: "upload" });
  const priorChoices = (ids: string[]): Record<string, PriorChoice> =>
    Object.fromEntries(ids.map((id) => {
      const p = priorOf(id);
      return [id, !usePrior ? { source: "none" } : p.source === "upload" ? { source: "upload", fileName: p.fileName, csv: p.csv } : { source: p.source }];
    }));

  const setupKey = JSON.stringify({ selected: [...selected].sort(), scenarioId, stores: [...stores].sort(), limit: limit.by === "steps" ? ["steps", limit.steps] : ["minutes", limit.minutes], locked: library.filter((e) => selected.includes(e.persona_id)).map((e) => e.lockedVersion), prior: usePrior ? [...selected].sort().map((id) => { const p = priorOf(id); return [id, p.source, p.source === "upload" ? `${p.fileName}:${p.csv?.length}` : ""]; }) : "none" });
  const [lastRun, setLastRun] = useState<{ key: string; simulationId: string } | null>(null);
  const canRepeat = !queue && exp.phase === "done" && lastRun?.key === setupKey && !!lastRun.simulationId;

  const previewOf = (ids: string[]): RunShopper[] =>
    library
      .filter((e) => ids.includes(e.persona_id))
      .map((e) => ({ id: e.persona_id, name: e.persona_name, tagline: "", style: "", color: colorOf(e), traits: { trend: 0, price: 0, research: 0, prestige: 0 }, source: e.lockedVersion ? "locked" : "provisional", version: e.lockedVersion }));

  // Runs the given personas on each store in turn. simulationId joins an existing simulation (a repeat).
  const runStores = async (o: { ids: string[]; storeIds: string[]; scenarioId: string; limit: { by: "steps" | "minutes"; steps?: number; minutes?: number }; simulationId?: string; allStores: string[]; priorData?: Record<string, PriorChoice> }) => {
    const sc = config.scenarios.find((x) => x.id === o.scenarioId)!;
    let simId = o.simulationId ?? "";
    cancelled.current = false;
    setJourney(o.ids[0] ?? "");
    setTab("experiment");
    const order = config.retailers.map((r) => r.id).filter((id) => o.storeIds.includes(id));
    for (let i = 0; i < order.length; i++) {
      if (cancelled.current) break;
      const store = order[i];
      setQueue({ current: i + 1, total: order.length, store });
      const out = await exp.run(
        {
          personaIds: o.ids,
          environment: store,
          stores: o.allStores,
          scenarioId: sc.id,
          limitBy: o.limit.by,
          minutesPerShopper: o.limit.minutes ?? 5,
          stepsPerShopper: o.limit.steps ?? 30,
          ...(simId ? { simulationId: simId } : {}),
          ...(!simId && o.priorData ? { priorData: o.priorData } : {}),
          context: {},
          mission: { objective: `${sc.title}: ${sc.why}`, budget: sc.budget, product_categories: [...new Set(sc.items.map((it) => it.category))] },
        },
        previewOf(o.ids),
      );
      if (out.simulationId) simId = out.simulationId;
      if (!out.completed) break;
    }
    setQueue(null);
    if (!cancelled.current && simId) {
      setOpenSim(simId);
      setTab("results");
    }
    return simId;
  };

  const run = async (again = false) => {
    const ids = library.filter((e) => selected.includes(e.persona_id) && e.lockedVersion !== null).map((e) => e.persona_id);
    const simId = await runStores({ ids, storeIds: stores, allStores: stores, scenarioId: scenario.id, limit: { by: limit.by, steps: limit.steps, minutes: limit.minutes }, simulationId: again && lastRun?.key === setupKey ? lastRun.simulationId : undefined, priorData: priorChoices(ids) });
    setLastRun({ key: setupKey, simulationId: simId });
  };
  const repeatFromResults = (r: RepeatRequest) => {
    runStores({ ids: r.personaIds, storeIds: r.stores, allStores: r.stores, scenarioId: r.scenarioId, limit: r.limit, simulationId: r.simulationId });
  };
  const stop = () => {
    cancelled.current = true;
    exp.stop();
    setQueue(null);
  };

  const onOpened = useCallback(() => setOpenSim(null), []);
  const exportRun = () => {
    const blob = new Blob(
      [JSON.stringify({ model: exp.meta?.model, mode: exp.meta?.mode, setup: exp.setup, results: exp.results, judge: exp.judge, exportedAt: new Date().toISOString() }, null, 2)],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `persona-cart-lab-run-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const initials = user
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const navButton = (n: (typeof NAV)[number]) => {
    const active = tab === n.id;
    return (
      <button
        key={n.id}
        type="button"
        onClick={() => setTab(n.id)}
        aria-current={active ? "page" : undefined}
        className={`flex min-h-11 w-full items-center justify-between rounded border-2 border-black px-3.5 py-2 text-left text-sm font-extrabold tracking-wide ${active ? "bg-black text-sun" : "bg-white shadow-[3px_3px_0_#000]"}`}
      >
        {n.label}
        {n.id === "experiment" && busy && <span className="h-2.5 w-2.5 animate-pulse rounded-full border-2 border-black bg-sun" aria-label="run in progress" />}
      </button>
    );
  };

  const modeChip = exp.meta ? (exp.meta.mode === "live" ? `Live run on ${exp.meta.model}` : "Simulation run") : null;

  return (
    <div className="flex min-h-screen flex-wrap bg-wash">
      <aside className="flex max-w-full flex-[1_1_232px] flex-col border-r-2 border-black bg-white">
        <div className="flex items-center gap-2.5 border-b-2 border-black bg-sun px-5 py-4">
          <span className="flex h-[34px] w-[34px] items-center justify-center rounded bg-black">
            <CartIcon color="#FFE14D" size={18} />
          </span>
          <span className="font-black tracking-wide">CART LAB</span>
        </div>
        <nav aria-label="Lab sections" className="flex flex-col gap-2 px-4 py-4">
          <span className="mx-1 mb-0.5 mt-1 text-xs font-bold tracking-widest text-muted">SETUP</span>
          {NAV.filter((n) => n.group === "setup").map(navButton)}
          <span className="mx-1 mb-0.5 mt-3.5 text-xs font-bold tracking-widest text-muted">REPORT</span>
          {NAV.filter((n) => n.group === "report").map(navButton)}
        </nav>
        <div className="mt-auto flex items-center gap-2.5 border-t-2 border-black px-4 py-3.5">
          <span className="flex h-9 w-9 items-center justify-center rounded border-2 border-black bg-[#A99BFF] text-sm font-extrabold" aria-hidden>
            {initials || "G"}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-bold">{user}</span>
          <button type="button" onClick={onLogout} className="rounded border-2 border-black bg-white px-2.5 py-1.5 text-[13px] font-bold">
            Log out
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-[999_1_640px] flex-col">
        <div className="flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b-2 border-black bg-white px-7 py-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-black tracking-wide">{NAV.find((n) => n.id === tab)!.label.toUpperCase()}</h1>
            {isReport && modeChip && <span className="mono border-2 border-black bg-sun px-2 py-0.5 text-xs font-semibold">{modeChip}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2.5 text-sm">

            {tab !== "experiment" && (
              <button type="button" onClick={() => setTab("experiment")} className="btn btn-ink min-h-10 px-3.5 py-1.5 text-[13px]">
                {busy ? "Watch the simulation" : "New simulation"}
              </button>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-6 p-7">
          {tab === "personas" && <PersonaLibrary config={config} onChange={refreshLibrary} />}
          {tab === "scenarios" && (
            <ScenariosTab
              config={config}
              scenarioId={scenario?.id ?? ""}
              onUse={(id) => {
                setScenarioId(id);
                setTab("experiment");
              }}
            />
          )}
          {tab === "experiment" && (
            <ExperimentTab
              config={config}
              library={library}
              selected={selected}
              setSelected={setSelected}
              scenarioId={scenario?.id ?? ""}
              setScenarioId={setScenarioId}
              limit={limit}
              setLimit={setLimit}
              canRepeat={canRepeat}
              stores={stores}
              setStores={setStores}
              queue={queue}
              onStop={stop}
              iteration={null}
              onRunAgain={() => run(true)}
              priorFiles={priorFiles}
              usePrior={usePrior}
              setUsePrior={setUsePrior}
              priorOf={priorOf}
              setPrior={(id, p) => setPriorPick({ ...priorPick, [id]: p })}
              exp={exp}
              onRun={() => run(false)}
              onOpenLibrary={() => setTab("personas")}
              onOpenJourney={() => {
                if (exp.meta?.simulationId) {
                  setOpenSim(exp.meta.simulationId);
                  setTab("results");
                }
              }}
            />
          )}
          {tab === "results" && <ResultsTab exp={exp} openSim={openSim} onOpened={onOpened} onRepeat={repeatFromResults} />}
        </div>
      </main>
    </div>
  );
}

function RunSummary({ setup, iteration }: { setup: NonNullable<ReturnType<typeof useExperiment>["setup"]>; iteration?: number }) {
  const list = setup.mission.shopping_list ?? [];
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-ink-2">
      <span>
        {iteration ? <span className="mr-2 font-bold text-black">Iteration {iteration}.</span> : null}
        <span className="font-bold text-black">Scenario:</span> {setup.objective} (${setup.budget}
        {list.length ? `; ${list.map((i) => `${i.item} ${i.priority === "must" ? "must" : i.priority === "preferred" ? "preferred" : "nice to have"}`).join(", ")}` : ""})
      </span>
      <span className="flex flex-wrap gap-1.5">
        {setup.personas.map((p) => (
          <span key={p.id} className={`tag ${p.source === "locked" ? "bg-black text-white" : "bg-white"}`}>
            {p.name}: {p.source === "locked" ? `locked v${p.version}` : "draft"}
          </span>
        ))}
      </span>
    </div>
  );
}
