import { useState } from "react";
import type { AppConfig } from "./lib";
import { Markdown } from "./Markdown";
import {
  BEHAVIOR_KEYS,
  BEHAVIOR_LABEL,
  DECISION_SCENARIO_LABELS,
  type BehaviorKey,
  type EvidenceRef,
  type PersonaDetail,
  type PersonaProfile,
  type RetailerId,
} from "./personaTypes";

const EVIDENCE_STYLE: Record<string, { label: string; bg: string }> = {
  research_supported: { label: "EVIDENCE", bg: "#3CC7B5" },
  retailer_specific: { label: "RETAILER-SPECIFIC", bg: "#8FD3FF" },
  inferred_rule: { label: "INFERRED", bg: "#FFE14D" },
  hypothetical_example: { label: "HYPOTHETICAL", bg: "#FFFFFF" },
};

const RETAILER_LABEL: Record<RetailerId, string> = { sephora: "Sephora", ulta: "Ulta Beauty" };
const label = (k: string) => BEHAVIOR_LABEL[k as BehaviorKey] ?? k.replace(/_/g, " ");

export function EvidenceList({ items }: { items: EvidenceRef[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((e, i) => {
        const s = EVIDENCE_STYLE[e.type];
        return (
          <li key={i} className="text-[13px] leading-snug">
            <span className="tag mr-1.5" style={{ background: s.bg }}>
              {s.label}
            </span>
            {e.note}
            {e.source_url && (
              <a href={e.source_url} target="_blank" rel="noreferrer" className="ml-1 break-all text-[12px] font-semibold underline">
                {new URL(e.source_url).hostname}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Pills<T extends string>({ options, value, onChange, labelOf, aria }: { options: T[]; value: T; onChange: (v: T) => void; labelOf: (v: T) => string; aria: string }) {
  return (
    <div role="tablist" aria-label={aria} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o} type="button" role="tab" aria-selected={o === value} onClick={() => onChange(o)} className={`chip min-h-9 ${o === value ? "bg-black text-white" : ""}`}>
          {labelOf(o)}
        </button>
      ))}
    </div>
  );
}

function List({ title, items, ordered }: { title: string; items: string[]; ordered?: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <div>
      <h4 className="text-[13px] font-black">{title}</h4>
      <Tag className={`mt-1 ${ordered ? "list-decimal" : "list-disc"} pl-5 text-[13px] leading-relaxed`}>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </Tag>
    </div>
  );
}

/* ---------------- Parameters in context ---------------- */

export function ParameterContextView({ p, config }: { p: PersonaProfile; config: AppConfig }) {
  const [key, setKey] = useState<BehaviorKey>("trend_sensitivity");
  const [retailer, setRetailer] = useState<RetailerId>("sephora");
  const pc = p.parameter_context!;
  const c = pc[key];
  const anchor = config.anchors.parameters[key];
  const score = p.behavioral_parameters[key];
  return (
    <>
      <p className="text-[13px] text-muted">
        Scores are relative tendencies on a shared scale (low below 0.35, medium 0.35 to 0.65, high above 0.65), not probabilities. A 0.90 does not mean the trait wins 90% of decisions.
      </p>
      <div className="flex flex-wrap items-start gap-5">
        <ul className="flex min-w-0 flex-[1_1_220px] flex-col gap-1.5" aria-label="Parameters">
          {BEHAVIOR_KEYS.map((k) => (
            <li key={k}>
              <button
                type="button"
                onClick={() => setKey(k)}
                aria-current={k === key}
                className={`grid w-full grid-cols-[1fr_44px] items-center gap-2 rounded border-2 border-black px-3 py-2 text-left text-[13px] font-bold ${k === key ? "bg-black text-white" : "bg-white"}`}
              >
                <span>{label(k)}</span>
                <span className="mono text-right">{p.behavioral_parameters[k].toFixed(2)}</span>
              </button>
            </li>
          ))}
        </ul>
        <section className="box flex min-w-0 flex-[3_1_420px] flex-col gap-4 p-5" aria-label={`${label(key)} in context`}>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-lg font-black">{label(key)}</h3>
            <span className="mono text-2xl font-semibold">{score.toFixed(2)}</span>
            <span className="chip uppercase">{c.band}</span>
          </div>
          <span className="block h-3 rounded-sm border-2 border-black bg-wash">
            <span className="block h-full bg-black" style={{ width: `${score * 100}%` }} />
          </span>
          <p className="text-sm">
            <span className="font-extrabold">Definition: </span>
            {c.definition}
          </p>
          <div className="grid gap-2 text-[12px] [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
            {(["low", "medium", "high"] as const).map((b) => (
              <div key={b} className={`rounded border-2 border-black p-2 ${b === c.band ? "bg-sun" : "bg-white opacity-70"}`}>
                <span className="font-black uppercase">{b}</span>
                <p className="mt-0.5 leading-snug">{anchor?.[b]}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
            <div>
              <h4 className="text-[13px] font-black">What this score means for the persona</h4>
              <p className="mt-1 text-[13px] leading-relaxed">{c.interpretation}</p>
            </div>
            <div>
              <h4 className="text-[13px] font-black">Why this score</h4>
              <p className="mt-1 text-[13px] leading-relaxed">{c.rationale}</p>
            </div>
            <div>
              <h4 className="text-[13px] font-black">How it shows up while shopping</h4>
              <p className="mt-1 text-[13px] leading-relaxed">{c.shopping_manifestation}</p>
            </div>
            <List title="Observable actions" items={c.observable_actions} />
          </div>
          <div className="flex flex-col gap-2 border-t-2 border-black pt-3">
            <Pills aria="Retailer" options={["sephora", "ulta"] as RetailerId[]} value={retailer} onChange={setRetailer} labelOf={(r) => RETAILER_LABEL[r]} />
            <p className="text-[13px] leading-relaxed">{c.retailer_examples[retailer]}</p>
          </div>
          <div className="border-t-2 border-black pt-3">
            <h4 className="mb-1.5 text-[13px] font-black">Evidence</h4>
            <EvidenceList items={c.evidence} />
          </div>
        </section>
      </div>
    </>
  );
}

/* ---------------- Shopping decisions ---------------- */

export function DecisionRulesView({ p }: { p: PersonaProfile }) {
  const rules = p.shopping_decision_rules!;
  const [id, setId] = useState(rules[0]?.scenario_id ?? "");
  const r = rules.find((x) => x.scenario_id === id) ?? rules[0];
  return (
    <>
      <p className="text-[13px] text-muted">How the persona reasons in common situations. These guide the agent; it still decides from the evidence it actually finds while shopping.</p>
      <div className="flex flex-wrap items-start gap-5">
        <ul className="flex min-w-0 flex-[1_1_240px] flex-col gap-1.5" aria-label="Situations">
          {rules.map((x) => (
            <li key={x.scenario_id}>
              <button
                type="button"
                onClick={() => setId(x.scenario_id)}
                aria-current={x.scenario_id === r.scenario_id}
                className={`w-full rounded border-2 border-black px-3 py-2 text-left text-[13px] font-bold leading-snug ${x.scenario_id === r.scenario_id ? "bg-black text-white" : "bg-white"}`}
              >
                {DECISION_SCENARIO_LABELS[x.scenario_id] ?? x.scenario_id}
              </button>
            </li>
          ))}
        </ul>
        <section className="box flex min-w-0 flex-[3_1_420px] flex-col gap-4 p-5" aria-label="Decision detail">
          <h3 className="text-lg font-black">{DECISION_SCENARIO_LABELS[r.scenario_id] ?? r.scenario_id}</h3>
          <div>
            <h4 className="text-[13px] font-black">1. Investigates first</h4>
            <p className="mt-1 text-[13px] leading-relaxed">{r.investigate_first}</p>
          </div>
          <List title="2. Information it looks for" items={r.information_sought} />
          <div>
            <h4 className="text-[13px] font-black">3. How it weighs conflicting information</h4>
            <p className="mt-1 text-[13px] leading-relaxed">{r.conflict_weighing}</p>
          </div>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
            <List title="4a. Could trigger purchase" items={r.purchase_triggers} />
            <List title="4b. Could trigger rejection" items={r.rejection_triggers} />
          </div>
          <div>
            <h4 className="text-[13px] font-black">5. Parameters that drive it</h4>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {r.influencing_parameters.map((k) => (
                <span key={k} className="chip">
                  {label(k)} <span className="mono">{(p.behavioral_parameters as any)[k]?.toFixed?.(2)}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="border-t-2 border-black pt-3">
            <h4 className="mb-1.5 text-[13px] font-black">Evidence</h4>
            <EvidenceList items={r.evidence} />
          </div>
        </section>
      </div>
    </>
  );
}

/* ---------------- Sephora vs Ulta ---------------- */

type RetailerView = RetailerId | "actions" | "report";

export function RetailersView({ p, research }: { p: PersonaProfile; research: PersonaDetail["retailerResearch"] }) {
  const [view, setView] = useState<RetailerView>("sephora");
  const rr = p.research_evidence.retailer_research;
  return (
    <>
      <Pills
        aria="Retailer views"
        options={["sephora", "ulta", "actions", "report"] as RetailerView[]}
        value={view}
        onChange={setView}
        labelOf={(v) => (v === "actions" ? "Observable actions (any retailer)" : v === "report" ? "Retailer research report" : RETAILER_LABEL[v])}
      />
      {(view === "sephora" || view === "ulta") && p.retailer_behavior && (
        <RetailerPanel b={p.retailer_behavior[view]} />
      )}
      {view === "actions" && p.expected_observable_actions && (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
          {(
            [
              ["Discovery", p.expected_observable_actions.discovery],
              ["Browsing", p.expected_observable_actions.browsing],
              ["Comparison", p.expected_observable_actions.comparison],
              ["Purchase", p.expected_observable_actions.purchase],
              ["Rejection or substitution", p.expected_observable_actions.rejection_or_substitution],
            ] as [string, string[]][]
          ).map(([t, xs]) => (
            <div key={t} className="box p-4">
              <List title={t} items={xs} />
            </div>
          ))}
        </div>
      )}
      {view === "report" &&
        (research ? (
          <div className="flex flex-wrap items-start gap-5">
            <div className="box max-h-[560px] min-w-0 flex-[2_1_380px] overflow-y-auto px-5 py-4">
              <Markdown text={research.report_text} />
            </div>
            <aside className="box min-w-0 flex-[1_1_240px] p-4">
              <h3 className="text-sm font-black tracking-wide">CITED SOURCES</h3>
              <p className="mt-1 text-xs text-muted">
                {rr?.web_search_calls} web searches on {rr?.research_date}
              </p>
              <ol className="mt-2 flex list-decimal flex-col gap-2 pl-5 text-[13px] leading-snug">
                {research.sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noreferrer" className="font-semibold underline decoration-2 underline-offset-2">
                      {s.title || s.url}
                    </a>
                    <span className="block break-all text-[11px] text-muted">{new URL(s.url).hostname}</span>
                  </li>
                ))}
              </ol>
            </aside>
          </div>
        ) : (
          <p className="text-sm text-muted">The retailer research report could not be found.</p>
        ))}
    </>
  );
}

export function RetailerPanel({ b }: { b: NonNullable<PersonaProfile["retailer_behavior"]>[RetailerId] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        {(
          [
            ["Discovery", b.discovery],
            ["Browsing", b.browsing],
            ["Comparison", b.comparison],
            ["Purchase", b.purchase],
          ] as [string, string[]][]
        ).map(([t, xs]) => (
          <div key={t} className="box p-4">
            <List title={t} items={xs} />
          </div>
        ))}
      </div>
      <div className="box p-4">
        <h3 className="text-sm font-black tracking-wide">SITE FEATURES THAT MATTER TO THIS PERSONA</h3>
        <p className="mt-1 text-xs text-muted">Only features marked verified are documented by a source from the retailer research. Agents must not rely on unverified ones.</p>
        <ul className="mt-2 flex flex-col gap-2">
          {b.relevant_site_features.map((f, i) => (
            <li key={i} className="text-[13px] leading-snug">
              <span className={`tag mr-1.5 ${f.verified ? "bg-black text-white" : "bg-white"}`}>{f.verified ? "VERIFIED" : "NOT VERIFIED"}</span>
              <span className="font-bold">{f.feature}:</span> {f.relevance}
              {f.source_url && (
                <a href={f.source_url} target="_blank" rel="noreferrer" className="ml-1 text-[12px] font-semibold underline">
                  {new URL(f.source_url).hostname}
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
        <div className="box bg-lilac p-4">
          <h3 className="text-sm font-black tracking-wide">HOW {b.display_name.toUpperCase()} DIFFERS</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed">{b.differences_from_other_retailers}</p>
        </div>
        <div className="box p-4">
          <h3 className="mb-1.5 text-sm font-black tracking-wide">EVIDENCE</h3>
          <EvidenceList items={b.evidence} />
        </div>
      </div>
    </div>
  );
}

/* ---------------- Scenarios ---------------- */

export function ScenariosView({ p }: { p: PersonaProfile }) {
  const list = p.behavioral_scenarios!;
  const [id, setId] = useState(list[0]?.scenario_id ?? "");
  const s = list.find((x) => x.scenario_id === id) ?? list[0];
  const rows: [string, keyof (typeof s.listings)[number]][] = [
    ["Price", "price_usd"],
    ["Popularity", "popularity"],
    ["Brand reputation", "brand_reputation"],
    ["Social influence", "social_influence"],
    ["Customer reviews", "customer_reviews"],
    ["Performance", "performance_claims"],
    ["Novelty", "novelty"],
  ];
  return (
    <>
      <p className="box bg-sun px-4 py-2.5 text-[13px] font-semibold">
        Hypothetical reference cases with fictional listings, used later to check how the agent behaves. They are not observed consumer behavior and not fixed outcomes.
      </p>
      <Pills aria="Scenarios" options={list.map((x) => x.scenario_id)} value={s.scenario_id} onChange={setId} labelOf={(v) => list.find((x) => x.scenario_id === v)?.title ?? v} />
      <section className="flex flex-col gap-4" aria-label={s.title}>
        <div className="flex flex-wrap items-baseline gap-3">
          <h3 className="text-lg font-black">{s.title}</h3>
          <span className="chip">Setting: {RETAILER_LABEL[s.retailer_setting]}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-[13px]">
            <thead>
              <tr>
                <th className="w-36 border-b-2 border-black py-2 pr-3 text-left font-black">Attribute</th>
                {s.listings.map((l) => (
                  <th key={l.label} className="border-b-2 border-black px-3 py-2 text-left font-black">
                    {l.label}
                    <span className="block text-[12px] font-normal text-muted">{l.description}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([t, k]) => (
                <tr key={t}>
                  <th scope="row" className="border-b border-dashed border-[#8A8796] py-2 pr-3 text-left font-bold">
                    {t}
                  </th>
                  {s.listings.map((l) => (
                    <td key={l.label} className="border-b border-dashed border-[#8A8796] px-3 py-2 align-top">
                      {k === "price_usd" ? <span className="mono font-semibold">${Number(l[k]).toFixed(2)}</span> : String(l[k])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
          <div className="box p-4">
            <List title="Expected journey" items={s.expected_journey} ordered />
          </div>
          <div className="box p-4">
            <h4 className="text-[13px] font-black">How the scores shape it</h4>
            <ul className="mt-1.5 flex flex-col gap-1.5 text-[13px] leading-snug">
              {s.parameter_influence.map((x, i) => (
                <li key={i}>
                  <span className="font-bold">
                    {label(x.parameter)} <span className="mono">{(p.behavioral_parameters as any)[x.parameter]?.toFixed?.(2)}</span>:
                  </span>{" "}
                  {x.effect}
                </li>
              ))}
            </ul>
          </div>
          <div className="box p-4">
            <h4 className="text-[13px] font-black">Plausible outcomes</h4>
            <ul className="mt-1.5 flex flex-col gap-1.5 text-[13px] leading-snug">
              {s.plausible_outcomes.map((o, i) => (
                <li key={i}>
                  <span className="font-bold">{o.outcome}</span> if {o.conditions}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}
