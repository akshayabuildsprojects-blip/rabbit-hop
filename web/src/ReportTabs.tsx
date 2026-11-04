import { useState } from "react";
import type { BasketItem, JudgeResult, PersonaConfig } from "../../shared/types";
import type { Experiment, LaneState, Step } from "./useExperiment";
import { PRIORITY_LABEL } from "../../shared/scenarios";
import { INFLUENCE_LABEL, jaccard, mainDriver, money, moneyRound, TOOL_TAG, type AppConfig } from "./lib";

export interface Row {
  p: PersonaConfig;
  lane: LaneState;
  items: BasketItem[];
  total: number;
  steps: Step[];
  stats: { searches: number; inspected: number; trend: number; alts: number; clicks: number; comparisons: number; rejections: number; adds: number };
  live: boolean;
  trendShare: number;
  avgPrice: number;
  driver: string;
  summary: string;
  coverage: { item: string; priority: "must" | "preferred" | "nice"; got?: BasketItem; skipped?: string }[];
  error?: string;
}

export function buildRows(exp: Experiment, trendIds: Set<string>): Row[] {
  const personas = exp.setup?.personas ?? [];
  return personas.map((p) => {
    const lane = exp.lanes[p.id] ?? { status: "idle", steps: [], items: [], total: 0, summary: "" };
    const result = exp.results?.find((r) => r.personaId === p.id);
    const items = result?.items ?? lane.items;
    const total = result?.total ?? lane.total;
    const count = (tool: string) => lane.steps.filter((s) => s.tool === tool).length;
    return {
      p,
      lane,
      items,
      total,
      steps: lane.steps,
      stats: {
        searches: count("search_catalog") + count("page_search"),
        inspected: count("get_product_details") + count("page_product"),
        trend: count("view_trend_feed"),
        alts: count("find_alternatives"),
        clicks: count("browser_click") + count("browser_double_click"),
        comparisons: count("compare_products"),
        rejections: count("reject_product"),
        adds: lane.steps.filter((s) => s.tool === "add_to_basket" && s.text.startsWith("Added")).length,
      },
      live: !!exp.setup?.environment && exp.setup.environment !== "sandbox",
      trendShare: items.length ? items.filter((i) => trendIds.has(i.productId)).length / items.length : 0,
      avgPrice: items.length ? total / items.length : 0,
      driver: mainDriver(items),
      summary: result?.summary ?? lane.summary,
      coverage: (exp.setup?.mission.shopping_list ?? []).map((li) => {
        const key = li.item.toLowerCase();
        const got = items.find((i) => (i.listItem ?? "").toLowerCase() === key) ?? items.find((i) => !i.listItem && i.name.toLowerCase().includes(key));
        const skip = result?.skipped?.find((x) => x.item.toLowerCase().includes(key));
        return { item: li.item, priority: li.priority, got, skipped: got ? undefined : skip?.reason };
      }),
      error: result?.error ?? lane.error,
    };
  });
}

export function EmptyReport({ onStart }: { onStart: () => void }) {
  return (
    <div className="card flex flex-col items-start gap-4 p-8">
      <h2 className="text-2xl font-black">No run yet</h2>
      <p className="max-w-[52ch] text-ink-2">Set a goal and budget, then run the experiment. This report fills in live while the agents shop.</p>
      <button type="button" onClick={onStart} className="btn btn-sun btn-raised">
        Set up an experiment
      </button>
    </div>
  );
}

function SectionHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-black pb-2.5">
      <h2 className="text-[17px] font-black tracking-wide">{title}</h2>
      {note && <span className="text-[13px] text-muted">{note}</span>}
    </div>
  );
}

const avgOverlap = (rows: Row[]) => {
  const ok = rows.filter((r) => !r.error);
  const pairs = ok.flatMap((a, i) => ok.slice(i + 1).map((b) => jaccard(a.items, b.items)));
  return pairs.length ? pairs.reduce((s, x) => s + x, 0) / pairs.length : 0;
};

/* ---------------- Overview ---------------- */

export function OverviewTab({ rows, budget, judge, phase }: { rows: Row[]; budget: number; judge: JudgeResult | null; phase: Experiment["phase"] }) {
  const ok = rows.filter((r) => !r.error && r.items.length);
  const totals = ok.map((r) => r.total);
  const overlap = avgOverlap(rows);
  const blindValue = judge ? (judge.simulated ? "Off" : `${judge.assignments.filter((a) => a.correct).length} of ${judge.assignments.length}${judge.behavior ? `, ${judge.behavior.assignments.filter((a) => a.correct).length} of ${judge.behavior.assignments.length}` : ""}`) : phase === "judging" ? "…" : "–";
  const blindNote = judge ? (judge.simulated ? "needs a Muse Spark key" : judge.behavior ? "on purchases, then with reasons" : "carts matched to their shopper") : phase === "judging" ? "the judge is reading the carts" : "runs after checkout";
  const low = ok.slice().sort((a, b) => a.total - b.total)[0];
  const high = ok.slice().sort((a, b) => b.total - a.total)[0];
  const computedHeadline =
    low && high && low !== high ? `Same feed, same budget: ${low.p.name} spent ${moneyRound(low.total)} and ${high.p.name} ${moneyRound(high.total)}, and carts shared ${Math.round(overlap * 100)}% of products on average.` : "";
  const headline = judge && !judge.simulated && judge.headline ? judge.headline : computedHeadline;

  const kpis = [
    { label: "BLIND TEST", value: blindValue, note: blindNote, hi: true },
    { label: "CART OVERLAP", value: `${Math.round(overlap * 100)}%`, note: "average shared products per pair" },
    { label: "SPEND RANGE", value: totals.length ? `${moneyRound(Math.min(...totals))}–${moneyRound(Math.max(...totals))}` : "–", note: "lowest to highest cart" },
    { label: "ITEMS BOUGHT", value: String(rows.reduce((s, r) => s + r.items.length, 0)), note: `across ${rows.length} carts` },
  ];

  return (
    <>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
        {kpis.map((k) => (
          <div key={k.label} className={`card flex flex-col gap-1.5 px-5 py-4 ${k.hi ? "bg-sun" : ""}`}>
            <span className="text-xs font-extrabold tracking-wider">{k.label}</span>
            <span className="mono text-[34px] font-semibold leading-tight">{k.value}</span>
            <span className="text-[13px] text-ink-2">{k.note}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-stretch gap-4">
        <figure className="card min-w-0 flex-[3_1_440px] px-5 py-5">
          <SectionHead title="SPEND BY SHOPPER" note={`of a $${budget} budget`} />
          <div className="mt-4 flex h-56 items-end gap-5 border-b-2 border-black px-2" role="img" aria-label={rows.map((r) => `${r.p.name} ${money(r.total)}`).join(", ")}>
            {rows.map((r) => (
              <div key={r.p.id} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={`${r.p.name}: ${money(r.total)}`}>
                <span className="mono text-sm font-semibold">{moneyRound(r.total)}</span>
                <div
                  className="w-full max-w-[72px] rounded-t border-2 border-b-0 border-black transition-[height] duration-500"
                  style={{ height: `${Math.max(1, Math.min(100, (r.total / budget) * 100))}%`, background: r.p.color }}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-5 px-2 pt-2">
            {rows.map((r) => (
              <span key={r.p.id} className="flex-1 text-center text-[13px] font-bold leading-tight">
                {r.p.name}
              </span>
            ))}
          </div>
        </figure>
        <div className="card flex min-w-0 flex-[2_1_300px] flex-col px-5 py-5">
          <SectionHead title="WHAT DROVE EACH CART" />
          <ul>
            {rows.map((r) => (
              <li key={r.p.id} className="dashed flex items-center justify-between gap-2.5 py-3">
                <span className="flex items-center gap-2 text-sm font-bold">
                  <span className="swatch h-3 w-3" style={{ background: r.p.color }} />
                  {r.p.name}
                </span>
                <span className="chip bg-wash">{r.error ? "Stopped" : r.driver}</span>
              </li>
            ))}
          </ul>
          {headline && <p className="mt-4 text-[15px] font-bold leading-snug">{headline}</p>}
        </div>
      </div>
    </>
  );
}

/* ---------------- Journeys ---------------- */

export function JourneysTab({ rows, pick, setPick, judge }: { rows: Row[]; pick: string; setPick: (id: string) => void; judge: JudgeResult | null }) {
  const r = rows.find((x) => x.p.id === pick) ?? rows[0];
  if (!r) return null;
  const fid = judge?.fidelity.find((f) => f.personaId === r.p.id);
  const stats = r.live
    ? [
        { label: "Searches", value: r.stats.searches },
        { label: "Clicks", value: r.stats.clicks },
        { label: "Product views", value: r.stats.inspected },
        { label: "Comparisons", value: r.stats.comparisons },
        { label: "Rejections", value: r.stats.rejections },
        { label: "Basket adds", value: r.stats.adds },
      ]
    : [
        { label: "Catalog searches", value: r.stats.searches },
        { label: "Products inspected", value: r.stats.inspected },
        { label: "Trend feed checks", value: r.stats.trend },
        { label: "Alternatives checked", value: r.stats.alts },
      ];
  return (
    <>
      <div role="tablist" aria-label="Shopper" className="flex flex-wrap gap-2.5">
        {rows.map((x) => {
          const on = x.p.id === r.p.id;
          return (
            <button
              key={x.p.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setPick(x.p.id)}
              className={`btn ${on ? "bg-black text-white" : "btn-raised"}`}
            >
              <span className="swatch h-3 w-3" style={{ background: x.p.color }} />
              {x.p.name}
              {x.lane.status === "running" && <span className="h-2 w-2 animate-pulse rounded-full bg-current" aria-label="shopping" />}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <section className="card min-w-0 flex-[3_1_440px] overflow-hidden" aria-label={`${r.p.name} journey`}>
          <div className="flex items-center justify-between gap-2.5 border-b-2 border-black px-5 py-3" style={{ background: r.p.color }}>
            <span className="font-black">{r.p.name} journey</span>
            <span className="mono text-[13px] font-semibold">{r.steps.length} steps</span>
          </div>
          <ol className="max-h-[460px] overflow-y-auto px-5 pb-3 pt-1" aria-live="polite">
            {r.steps.length === 0 && <li className="py-4 text-sm text-muted">{r.error ? `Stopped: ${r.error}` : "Thinking about where to start…"}</li>}
            {r.steps.map((s, i) => {
              const tag = TOOL_TAG[s.tool] ?? { label: "STEP", bg: "#fff" };
              return (
                <li key={i} className="dashed drop-in grid grid-cols-[30px_96px_1fr] items-baseline gap-3 py-2.5 text-sm">
                  <span className="mono text-[13px] text-muted">{String(i + 1).padStart(2, "0")}</span>
                  <span className="tag justify-self-start" style={{ background: tag.bg, color: tag.fg }}>
                    {tag.label}
                  </span>
                  <span>
                    <span className="block font-semibold">{s.text}</span>
                    {s.thought && <span className="mt-0.5 block text-[13px] italic text-muted">{s.thought}</span>}
                  </span>
                </li>
              );
            })}
            {r.lane.pendingThought && (
              <li className="py-2.5 pl-[138px] text-[13px] italic text-muted">{r.lane.pendingThought}</li>
            )}
          </ol>
        </section>
        <div className="grid min-w-0 flex-[1_1_240px] grid-cols-2 gap-3.5">
          {stats.map((c) => (
            <div key={c.label} className="box flex flex-col gap-1 p-4">
              <span className="mono text-3xl font-semibold">{c.value}</span>
              <span className="text-[13px] font-bold">{c.label}</span>
            </div>
          ))}
          {r.coverage.length > 0 && (
            <div className="box col-span-2 flex flex-col gap-2 p-4 text-sm">
              <span className="font-extrabold">Shopping list</span>
              {r.coverage.map((c) => (
                <div key={c.item} className="flex flex-col gap-0.5 border-t-2 border-dashed border-black pt-1.5 first:border-0 first:pt-0">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-bold">
                      {c.got ? "✓" : "✗"} {c.item}
                    </span>
                    <span className="text-xs text-muted">{PRIORITY_LABEL[c.priority]}</span>
                  </span>
                  <span className="text-[13px] text-ink-2">
                    {c.got ? `${c.got.brand} ${c.got.name}, ${money(c.got.price)}` : c.skipped ? `Skipped: ${c.skipped}` : r.lane.status === "running" ? "Not yet" : "Not bought"}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="box col-span-2 bg-lilac p-4 text-sm leading-relaxed">
            <span className="mb-1 block font-extrabold">At checkout</span>
            {r.summary ? <span className="italic">“{r.summary}”</span> : <span className="text-muted">Still shopping.</span>}
          </div>
          {fid && (
            <div className="box col-span-2 p-4 text-sm leading-relaxed">
              <span className="mb-1 block font-extrabold">
                Judge scores: persona fidelity <span className="mono">{fid.score}/10</span>, goal fit <span className="mono">{fid.goalFit}/10</span>
              </span>
              {fid.note}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ---------------- Baskets ---------------- */

export function BasketsTab({ rows, budget, config }: { rows: Row[]; budget: number; config: AppConfig }) {
  const links = new Map(config.catalog.map((p) => [p.id, p.link]));
  return (
    <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(250px,1fr))]">
      {rows.map((r) => (
        <section key={r.p.id} className="card overflow-hidden" aria-label={`${r.p.name} basket`}>
          <div className="flex items-center justify-between border-b-2 border-black px-4 py-3" style={{ background: r.p.color }}>
            <span className="font-black">{r.p.name}</span>
            <span className="mono text-[13px] font-semibold">{r.items.length} items</span>
          </div>
          <ul className="max-h-[400px] overflow-y-auto px-4 py-1">
            {r.items.length === 0 && <li className="py-3 text-sm text-muted">{r.error ? `Stopped: ${r.error}` : "Nothing in the cart yet."}</li>}
            {r.items.map((it) => (
              <li key={it.productId} className="dashed drop-in py-2.5">
                <div className="flex justify-between gap-2.5 text-sm">
                  <a href={links.get(it.productId)} target="_blank" rel="noreferrer" className="hover:underline">
                    <span className="font-extrabold">{it.brand}</span> {it.name}
                  </a>
                  <span className="mono shrink-0 font-semibold">{money(it.price)}</span>
                </div>
                <div className="mt-1 flex items-start gap-2 text-xs text-muted">
                  <span className="tag shrink-0 bg-white text-black">{INFLUENCE_LABEL[it.influence] ?? it.influence}</span>
                  <span className="line-clamp-2">{it.reason}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2 border-t-2 border-black px-4 pb-4 pt-3">
            <div className="flex justify-between text-base font-black">
              <span>Total</span>
              <span className="mono">{money(r.total)}</span>
            </div>
            <span className="block h-2.5 rounded-sm border-2 border-black bg-wash">
              <span className="block h-full" style={{ width: `${Math.min(100, (r.total / budget) * 100)}%`, background: r.p.color }} />
            </span>
            <span className="text-xs text-muted">
              {money(Math.max(0, Math.round((budget - r.total) * 100) / 100))} left of ${budget}
            </span>
          </div>
        </section>
      ))}
    </div>
  );
}

/* ---------------- Behavior ---------------- */

const METRICS: { key: string; label: string; hint: string; v: (r: Row) => number; f: (n: number) => string; max?: (budget: number) => number }[] = [
  { key: "spend", label: "Spend", hint: "Total spent against the shared budget.", v: (r) => r.total, f: moneyRound, max: (b) => b },
  { key: "avg", label: "Avg price per item", hint: "Price sensitivity: what each shopper paid per product.", v: (r) => r.avgPrice, f: moneyRound },
  { key: "trend", label: "Trend-feed share", hint: "Share of each cart that the shared trend feed mentioned.", v: (r) => r.trendShare * 100, f: (n) => `${Math.round(n)}%`, max: () => 100 },
  { key: "inspect", label: "Products inspected", hint: "Research depth: product detail pages each agent opened.", v: (r) => r.stats.inspected, f: (n) => String(n) },
  { key: "alts", label: "Alternatives checked", hint: "Dupe seeking: how often each agent looked for a cheaper option.", v: (r) => r.stats.alts, f: (n) => String(n) },
];

export function BehaviorTab({ rows, budget }: { rows: Row[]; budget: number }) {
  const [key, setKey] = useState("spend");
  const m = METRICS.find((x) => x.key === key)!;
  const max = m.max?.(budget) ?? (Math.max(...rows.map(m.v)) || 1);
  return (
    <div className="flex flex-wrap items-start gap-4">
      <section className="card min-w-0 flex-[3_1_460px] px-5 py-5" aria-label="Behavior metrics">
        <div role="tablist" aria-label="Metric" className="flex flex-wrap gap-2 border-b-2 border-black pb-3.5">
          {METRICS.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={x.key === key} onClick={() => setKey(x.key)} className={`btn min-h-10 px-3 py-1.5 text-[13px] ${x.key === key ? "btn-sun" : ""}`}>
              {x.label}
            </button>
          ))}
        </div>
        <p className="mt-4 text-sm text-ink-2">{m.hint}</p>
        <div className="mt-4 flex flex-col gap-3.5">
          {rows.map((r) => {
            const v = m.v(r);
            return (
              <div key={r.p.id} className="grid grid-cols-[minmax(90px,140px)_1fr_64px] items-center gap-3.5" title={`${r.p.name}: ${m.f(v)}`}>
                <span className="text-sm font-bold leading-tight">{r.p.name}</span>
                <div className="h-[30px] overflow-hidden rounded border-2 border-black bg-wash">
                  <div className="h-full border-r-2 border-black transition-[width] duration-500" style={{ width: `${Math.max(1.5, Math.min(100, (v / max) * 100))}%`, background: r.p.color }} />
                </div>
                <span className="mono text-right text-[15px] font-semibold">{m.f(v)}</span>
              </div>
            );
          })}
        </div>
      </section>
      <section className="card min-w-0 flex-[2_1_320px] px-5 py-5" aria-label="Cart overlap">
        <SectionHead title="CART OVERLAP" />
        <p className="mt-3 text-[13px] text-muted">Share of products two shoppers both bought. Lower means more distinct behavior.</p>
        <div className="mt-3.5 overflow-x-auto">
          <table className="border-separate border-spacing-1 text-sm">
            <thead>
              <tr>
                <th />
                {rows.map((r) => (
                  <th key={r.p.id} scope="col" className="max-w-[72px] px-1 pb-1 text-center text-[11px] font-bold leading-tight">
                    {r.p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.p.id}>
                  <th scope="row" className="pr-2 text-left text-[11px] font-bold leading-tight">
                    {a.p.name}
                  </th>
                  {rows.map((b) => {
                    if (a.p.id === b.p.id) return <td key={b.p.id} className="h-12 w-14 rounded border-2 border-dashed border-[#B7B4C2]" />;
                    const v = jaccard(a.items, b.items);
                    return (
                      <td
                        key={b.p.id}
                        className="mono h-12 w-14 rounded border-2 border-black text-center font-semibold"
                        style={{ background: v === 0 ? "#FFFFFF" : v < 0.25 ? "#E7E4FF" : "#A99BFF" }}
                        title={`${a.p.name} and ${b.p.name}: ${Math.round(v * 100)}%`}
                      >
                        {Math.round(v * 100)}%
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* ---------------- Blind test ---------------- */

export function BlindTab({ rows, judge, judgeError, phase }: { rows: Row[]; judge: JudgeResult | null; judgeError: string | null; phase: Experiment["phase"] }) {
  const byId = new Map(rows.map((r) => [r.p.id, r]));
  if (!judge) {
    return (
      <div className="card p-6">
        <h2 className="text-xl font-black">{phase === "judging" ? "The judge is reading the carts" : phase === "shopping" ? "The blind test runs after checkout" : "No judge result"}</h2>
        <p className="mt-2 text-ink-2">
          {judgeError ? `The judge did not finish: ${judgeError}` : "A separate Muse Spark call sees only the products in each shuffled, unlabeled cart and has to say which shopper built it."}
        </p>
      </div>
    );
  }
  const correct = judge.assignments.filter((a) => a.correct).length;
  return (
    <>
      {judge.simulated ? (
        <div className="card flex flex-wrap items-center gap-4 bg-sun px-6 py-5">
          <p className="flex-[1_1_320px] font-semibold leading-relaxed">
            Simulation mode, so no judge ran. Add your Meta Model API key to have Muse Spark match each unlabeled cart below to its shopper.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
          <div className="card flex flex-col gap-2 bg-sun px-6 py-5">
            <span className="text-[13px] font-extrabold">Purchases only</span>
            <span className="mono text-[48px] font-semibold leading-none">
              {correct} of {judge.assignments.length}
            </span>
            <p className="text-sm font-semibold leading-relaxed">Carts matched to the right shopper by a judge that saw only the products in each cart. No reasons, no persona names, carts shuffled.</p>
          </div>
          {judge.behavior && (
            <div className="card flex flex-col gap-2 bg-lilac px-6 py-5">
              <span className="text-[13px] font-extrabold">Purchases, reasons and activity</span>
              <span className="mono text-[48px] font-semibold leading-none">
                {judge.behavior.assignments.filter((a) => a.correct).length} of {judge.behavior.assignments.length}
              </span>
              <p className="text-sm font-semibold leading-relaxed">
                A second judge also saw each shopper's reasons and what they did: searches, product views, comparisons and rejections. Persona names were removed.
              </p>
            </div>
          )}
        </div>
      )}
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(250px,1fr))]">
        {judge.assignments
          .slice()
          .sort((a, b) => a.basket.localeCompare(b.basket))
          .map((a) => {
            const actual = byId.get(a.actualPersonaId);
            const guessed = byId.get(a.guessedPersonaId);
            const fid = judge.fidelity.find((f) => f.personaId === a.actualPersonaId);
            return (
              <section key={a.basket} className="box flex flex-col gap-3 p-4" aria-label={`Cart ${a.basket}`}>
                <div className="flex items-center justify-between">
                  <span className="mono flex h-10 w-10 items-center justify-center rounded border-2 border-black text-lg font-semibold">{a.basket}</span>
                  {!judge.simulated && <span className="text-[13px] font-extrabold">{a.correct ? "✓ Identified" : `✗ Guessed ${guessed?.p.name ?? a.guessedPersonaId}`}</span>}
                </div>
                <p className="text-[13px] leading-relaxed text-muted">{actual?.items.map((i) => `${i.brand} ${i.name}`).join(", ") || "Empty cart"}</p>
                <div className="flex items-center gap-2 border-t-2 border-black pt-2.5">
                  <span className="swatch h-3 w-3" style={{ background: actual?.p.color }} />
                  <span className="font-extrabold">{actual?.p.name}</span>
                </div>
                {a.rationale && <p className="text-sm leading-snug">{a.rationale}</p>}
                {(() => {
                  const b = judge.behavior?.assignments.find((x) => x.actualPersonaId === a.actualPersonaId);
                  if (!b) return null;
                  const g = byId.get(b.guessedPersonaId);
                  return (
                    <p className="border-t-2 border-dashed border-black pt-2 text-[13px] leading-snug">
                      <span className="font-extrabold">With reasons and activity: {b.correct ? "✓ identified" : `✗ guessed ${g?.p.name ?? b.guessedPersonaId}`}.</span> {b.rationale}
                    </p>
                  );
                })()}
                {fid && (
                  <p className="text-xs text-muted">
                    Fidelity <span className="mono font-semibold text-black">{fid.score}/10</span>, goal fit <span className="mono font-semibold text-black">{fid.goalFit}/10</span>
                  </p>
                )}
              </section>
            );
          })}
      </div>
    </>
  );
}
