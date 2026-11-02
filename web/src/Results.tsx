import type { AgentResult, JudgeResult, Persona } from "../../shared/types";
import { INFLUENCE_LABEL } from "./App";

type PublicPersona = Omit<Persona, "systemPrompt">;

interface Props {
  trendIds: Set<string>;
  personas: PublicPersona[];
  results: AgentResult[];
  judge: JudgeResult | null;
  judgeError: string | null;
  judging: boolean;
  budget: number;
  objective: string;
}

export function Results({ trendIds, personas, results, judge, judgeError, judging, budget, objective }: Props) {
  const ok = results.filter((r) => !r.error);
  const pById = new Map(personas.map((p) => [p.id, p]));
  const name = (id: string) => pById.get(id)?.name ?? id;

  const metrics: { label: string; hint: string; value: (r: AgentResult) => number; fmt: (n: number) => string }[] = [
    { label: "Spend", hint: `of a $${budget} budget`, value: (r) => r.total, fmt: (n) => `$${n.toFixed(0)}` },
    { label: "Items bought", hint: "basket size", value: (r) => r.items.length, fmt: (n) => `${n}` },
    { label: "Average price per item", hint: "price sensitivity", value: (r) => (r.items.length ? r.total / r.items.length : 0), fmt: (n) => `$${n.toFixed(0)}` },
    { label: "Items the trend feed mentioned", hint: "social influence", value: (r) => (r.items.length ? r.items.filter((i) => trendIds.has(i.productId)).length / r.items.length : 0), fmt: (n) => `${Math.round(n * 100)}%` },
    { label: "Products inspected", hint: "research depth", value: (r) => r.stats.productsInspected, fmt: (n) => `${n}` },
    { label: "Alternatives checked", hint: "dupe seeking", value: (r) => r.stats.alternativesChecked, fmt: (n) => `${n}` },
  ];

  const influences = Object.keys(INFLUENCE_LABEL);
  const jaccard = (a: AgentResult, b: AgentResult) => {
    const A = new Set(a.items.map((i) => i.productId));
    const B = new Set(b.items.map((i) => i.productId));
    const inter = [...A].filter((x) => B.has(x)).length;
    const union = new Set([...A, ...B]).size;
    return union ? inter / union : 0;
  };
  const pairs = ok.flatMap((a, i) => ok.slice(i + 1).map((b) => jaccard(a, b)));
  const avgOverlap = pairs.length ? pairs.reduce((s, x) => s + x, 0) / pairs.length : 0;

  const exportRun = () => {
    const blob = new Blob([JSON.stringify({ objective, budget, results, judge, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `persona-cart-lab-run-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section aria-label="Comparison" className="mt-14">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">How the carts differ</h2>
        <button type="button" onClick={exportRun} className="rounded-full border border-ink px-5 py-2 text-sm font-medium">
          Download run data
        </button>
      </div>

      {/* Blind judge */}
      <div className="grid gap-8 py-8 lg:grid-cols-[1fr_1.3fr]">
        <div>
          <p className="text-sm font-medium text-muted">Blind test</p>
          {judge ? (
            <>
              <p className="mt-2 font-display text-4xl font-bold leading-tight sm:text-5xl">
                {Math.round(judge.accuracy * judge.assignments.length)} of {judge.assignments.length}
              </p>
              <p className="mt-1 max-w-md text-ink-2">
                carts matched to the right shopper by a separate Muse Spark judge that saw only the products, not the reasons or the persona names.
              </p>
              <p className="mt-6 max-w-md font-display text-xl font-semibold leading-snug">{judge.headline}</p>
            </>
          ) : judging ? (
            <p className="mt-2 text-ink-2">The judge is reading the carts…</p>
          ) : (
            <p className="mt-2 text-ink-2">{judgeError ? `The judge did not finish: ${judgeError}` : "The judge needs at least two finished carts."}</p>
          )}
        </div>
        {judge && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {judge.assignments.map((a) => {
              const fid = judge.fidelity.find((f) => f.personaId === a.actualPersonaId);
              return (
                <li key={a.basket} className="rounded-lg border border-line bg-panel p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-display text-lg font-bold">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: pById.get(a.actualPersonaId)?.color }} aria-hidden />
                      {name(a.actualPersonaId)}
                    </span>
                    <span className={a.correct ? "font-medium" : "font-medium text-muted"}>{a.correct ? "✓ Identified" : `✗ Guessed ${name(a.guessedPersonaId)}`}</span>
                  </div>
                  <p className="mt-2 text-ink-2">{a.rationale}</p>
                  {fid && fid.score > 0 && (
                    <p className="mt-2 text-muted">
                      <span className="tabular font-medium text-ink">Persona fidelity {fid.score}/10.</span> {fid.note}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Metric small multiples */}
      <div className="grid gap-x-10 gap-y-8 border-t border-line py-8 md:grid-cols-2 xl:grid-cols-3">
        {metrics.map((m) => {
          const max = Math.max(...ok.map(m.value), 0.0001);
          return (
            <figure key={m.label}>
              <figcaption className="mb-3">
                <span className="font-display text-lg font-bold">{m.label}</span> <span className="text-sm text-muted">{m.hint}</span>
              </figcaption>
              <ul className="space-y-2">
                {ok.map((r) => {
                  const v = m.value(r);
                  const p = pById.get(r.personaId)!;
                  return (
                    <li key={r.personaId} className="grid grid-cols-[8.5rem_1fr_3.5rem] items-center gap-3 text-sm" title={`${p.name}: ${m.fmt(v)}`}>
                      <span className="truncate text-ink-2">{p.name}</span>
                      <span className="h-3 rounded-r bg-line/50">
                        <span className="block h-full rounded-r" style={{ width: `${Math.max(1.5, (v / max) * 100)}%`, background: p.color }} />
                      </span>
                      <span className="tabular text-right font-medium">{m.fmt(v)}</span>
                    </li>
                  );
                })}
              </ul>
            </figure>
          );
        })}
      </div>

      {/* Influence mix and overlap */}
      <div className="grid gap-10 border-t border-line py-8 lg:grid-cols-2">
        <div>
          <h3 className="font-display text-lg font-bold">What drove each purchase</h3>
          <p className="text-sm text-muted">Count of items by the main influence each agent declared when adding it.</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th className="py-2 pr-3 font-medium">Shopper</th>
                  {influences.map((k) => (
                    <th key={k} className="px-2 py-2 text-center font-medium">
                      {INFLUENCE_LABEL[k]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ok.map((r) => (
                  <tr key={r.personaId} className="border-t border-line">
                    <td className="py-2 pr-3 font-medium">{name(r.personaId)}</td>
                    {influences.map((k) => {
                      const n = r.items.filter((i) => i.influence === k).length;
                      const share = r.items.length ? n / r.items.length : 0;
                      return (
                        <td key={k} className="px-1 py-1 text-center">
                          <span
                            className="tabular block rounded py-1.5"
                            style={{ background: n ? `color-mix(in oklab, var(--ink) ${Math.round(8 + share * 62)}%, transparent)` : "transparent", color: share > 0.45 ? "var(--base)" : "var(--ink)" }}
                          >
                            {n || "·"}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="font-display text-lg font-bold">How much the carts overlap</h3>
          <p className="text-sm text-muted">
            Share of products two shoppers both bought. Average across pairs: <span className="tabular font-medium text-ink">{Math.round(avgOverlap * 100)}%</span>. Lower means more distinct behavior.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr>
                  <th />
                  {ok.map((r) => (
                    <th key={r.personaId} className="px-1 pb-2 text-center text-xs font-medium text-muted">
                      {name(r.personaId)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ok.map((a) => (
                  <tr key={a.personaId}>
                    <th className="pr-3 text-left text-xs font-medium text-muted">{name(a.personaId)}</th>
                    {ok.map((b) => {
                      const same = a.personaId === b.personaId;
                      const v = same ? 1 : jaccard(a, b);
                      return (
                        <td key={b.personaId} className="p-0.5">
                          <span
                            className="tabular flex h-12 w-16 items-center justify-center rounded"
                            style={{ background: same ? "transparent" : `color-mix(in oklab, var(--ink) ${Math.round(6 + v * 70)}%, transparent)`, color: v > 0.45 && !same ? "var(--base)" : "var(--ink)" }}
                            title={same ? "" : `${name(a.personaId)} and ${name(b.personaId)}: ${Math.round(v * 100)}% overlap`}
                          >
                            {same ? "" : `${Math.round(v * 100)}%`}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p className="border-t border-line pt-6 text-xs text-muted">
        Catalog prices are approximate Sephora US list prices entered by hand. Ratings, review summaries, buzz scores and the trend feed are simulated. This is a behavioral experiment, not market research; results need validation against real shoppers.
      </p>
    </section>
  );
}
