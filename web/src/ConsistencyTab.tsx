import type { PersonaConsistency } from "../../shared/consistency";

const pct = (x: number) => `${Math.round(x * 100)}%`;

// How one persona + store + scenario combination behaved across its repeats.
export function ConsistencyTable({ c, name, color }: { c: PersonaConsistency; name: string; color: string }) {
  if (c.runs < 2)
    return (
      <div className="card p-5 text-sm">
        <span className="font-bold">Consistency needs a repeat.</span> This combination has {c.runs} completed run{c.runs === 1 ? "" : "s"}. Repeat it under the same conditions to compare how it behaves each time.
      </div>
    );
  return (
    <section className="card overflow-hidden" aria-label={`${name} consistency`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-black px-5 py-3" style={{ background: color }}>
        <span className="font-black">Consistency across {c.runs} repeats</span>
        <span className="mono text-xl font-semibold">{pct(c.score)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead>
            <tr className="border-b-2 border-black">
              <th className="px-4 py-2 font-extrabold">Behavior</th>
              {Array.from({ length: c.runs }, (_, i) => (
                <th key={i} className="px-4 py-2 font-extrabold">
                  Repeat {i + 1}
                </th>
              ))}
              <th className="px-4 py-2 text-right font-extrabold">Agreement</th>
            </tr>
          </thead>
          <tbody>
            {c.fields.map((f) => (
              <tr key={f.field} className="border-b border-dashed border-black last:border-0">
                <td className="px-4 py-2 font-bold">{f.label}</td>
                {f.values.map((v, i) => (
                  <td key={i} className="px-4 py-2">
                    {v}
                  </td>
                ))}
                <td className="mono px-4 py-2 text-right font-semibold">{pct(f.agreement)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
