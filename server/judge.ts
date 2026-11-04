import type { AgentResult, ExperimentConfig, JudgeResult, PersonaConfig } from "../shared/types.js";
import { extractJson, llm, MODEL_ID } from "./llm.js";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const personaLine = (p: PersonaConfig) =>
  `- ${p.id}: ${p.name}. ${p.tagline} Dials 0-100: trend ${p.traits.trend}, price sensitivity ${p.traits.price}, research ${p.traits.research}, prestige ${p.traits.prestige}.`;

// Full persona description for the judges: all scores, rules and situations from the brief.
const personaCard = (p: PersonaConfig) => `### ${p.id} (${p.name})\n${p.tagline}\n${p.style}`;

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Removes text that names the persona, so the judge has to infer it from behavior.
export function redact(text: string, personas: PersonaConfig[]): string {
  let out = text;
  for (const p of personas) {
    for (const n of [p.name, p.id, p.id.replace(/-/g, " ")]) if (n) out = out.replace(new RegExp(escapeRe(n), "gi"), "[persona]");
  }
  return out.replace(/\bas an? [^.,;:]{0,40}?shopper\b/gi, "as [persona]");
}

export function behaviorText(r: AgentResult, personas: PersonaConfig[]): string {
  const lines: string[] = [];
  lines.push(`Basket total $${r.total}:`);
  lines.push(...(r.items.map((it) => `  - ${it.brand} ${it.name} (${it.category}, ${it.tier}) $${it.price}. Main factor: ${it.influence}. Reason: ${it.reason}`) || []));
  if (!r.items.length) lines.push("  (empty)");
  const s = r.stats;
  lines.push(
    s.clicks !== undefined
      ? `Activity: ${s.searches} searches, ${s.clicks} clicks, ${s.productsInspected} product views, ${s.comparisons ?? 0} comparisons, ${s.rejections ?? 0} rejections, ${s.removals} removals.`
      : `Activity: ${s.searches} catalog searches, ${s.productsInspected} products inspected, ${s.trendChecks} trend feed checks, ${s.alternativesChecked} alternative lookups, ${s.removals} removals.`,
  );
  const timeline = (r.activity ?? []).filter((a) => ["search", "product_view", "compare", "reject", "add", "remove"].includes(a.kind)).slice(0, 60);
  if (timeline.length) {
    lines.push("Timeline:");
    lines.push(...timeline.map((a) => `  ${a.t}s ${a.kind}: ${a.detail}${a.reason ? ` (reason: ${a.reason})` : ""}`));
  }
  if (r.summary) lines.push(`Own summary: ${r.summary}`);
  return redact(lines.join("\n"), personas);
}

type Assign = { basket: string; persona_id: string; rationale: string };
function score(raw: Assign[] | undefined, labelOf: Map<string, string>) {
  const assignments = (raw ?? []).map((a) => {
    const actual = labelOf.get(a.basket) ?? "";
    return { basket: a.basket, guessedPersonaId: a.persona_id, actualPersonaId: actual, correct: a.persona_id === actual, rationale: a.rationale };
  });
  return { assignments, accuracy: assignments.length ? assignments.filter((a) => a.correct).length / assignments.length : 0 };
}

export async function runJudge(results: AgentResult[], personas: PersonaConfig[], cfg: ExperimentConfig, live: boolean): Promise<JudgeResult> {
  const valid = results.filter((r) => !r.error);
  const shuffled = shuffle(valid);
  const labelOf = new Map(shuffled.map((r, i) => [LETTERS[i], r.personaId]));

  if (!live) {
    return {
      simulated: true,
      assignments: [...labelOf.entries()].map(([basket, actual]) => ({ basket, guessedPersonaId: "", actualPersonaId: actual, correct: false, rationale: "" })),
      accuracy: 0,
      fidelity: [],
      headline: "",
    };
  }

  const used = personas.filter((p) => valid.some((r) => r.personaId === p.id));
  const cards = used.map(personaCard).join("\n\n");
  const basketText = shuffled
    .map((r, i) => `Basket ${LETTERS[i]} (total $${r.total}):\n${r.items.map((it) => `  - ${it.brand} ${it.name}, ${it.category}, $${it.price}`).join("\n") || "  (empty)"}`)
    .join("\n\n");
  const behaviorShuffled = shuffle(valid);
  const behaviorLabel = new Map(behaviorShuffled.map((r, i) => [LETTERS[i], r.personaId]));
  const behaviorBlock = behaviorShuffled.map((r, i) => `Shopper ${LETTERS[i]}:\n${behaviorText(r, used)}`).join("\n\n");
  const answer = `Assign each one to exactly one persona id. Each persona is used at most once. Reply with JSON only:\n{"assignments":[{"basket":"A","persona_id":"...","rationale":"one sentence"}]}`;

  const blindPrompt = `You are evaluating a consumer behavior experiment. Several shopping agents with different personas each built a basket under the same mission and budget. You see only what they bought.

Personas:
${cards}

${basketText}

${answer}`;

  const behaviorPrompt = `You are evaluating a consumer behavior experiment. Several shopping agents with different personas shopped under the same mission and budget. For each anonymous shopper you see what they bought, the reason given for each item, and what they did while shopping (searches, product views, comparisons, rejections). Persona names have been removed. Infer each persona from behavior and reasoning.

Personas:
${cards}

${behaviorBlock}

${answer.replace('"basket":"A"', '"basket":"A"')}`;

  const fidelityPrompt = `Shopping goal given to every agent: "${cfg.objective}". Budget: $${cfg.budget}.

For each agent, score from 0 to 10:
- score: how faithfully it behaved like its persona, using its purchases, its stated reasons and its shopping activity
- goal_fit: how well the basket actually fulfills the shopping goal

${valid
  .map((r) => {
    const p = used.find((x) => x.id === r.personaId)!;
    return `${personaLine(p)}\n${behaviorText(r, [])}`;
  })
  .join("\n\n")}

Reply with JSON only:
{"fidelity":[{"persona_id":"...","score":0,"goal_fit":0,"note":"one sentence"}],"headline":"one sentence on the most interesting behavioral difference across personas"}`;

  const ask = (content: string) => llm().chat.completions.create({ model: MODEL_ID, messages: [{ role: "user", content }] });
  const [blindRes, behaviorRes, fidRes] = await Promise.all([ask(blindPrompt), ask(behaviorPrompt), ask(fidelityPrompt)]);
  const blind = extractJson<{ assignments: Assign[] }>(blindRes.choices[0]?.message?.content ?? "");
  const beh = extractJson<{ assignments: Assign[] }>(behaviorRes.choices[0]?.message?.content ?? "");
  const fid = extractJson<{ fidelity: { persona_id: string; score: number; goal_fit: number; note: string }[]; headline: string }>(fidRes.choices[0]?.message?.content ?? "");

  const purchase = score(blind.assignments, labelOf);
  return {
    simulated: false,
    assignments: purchase.assignments,
    accuracy: purchase.accuracy,
    behavior: score(beh.assignments, behaviorLabel),
    fidelity: (fid.fidelity ?? []).map((f) => ({ personaId: f.persona_id, score: Number(f.score) || 0, goalFit: Number(f.goal_fit) || 0, note: f.note })),
    headline: fid.headline ?? "",
  };
}
