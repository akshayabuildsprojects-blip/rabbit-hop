import type { AgentResult, JudgeResult, Persona } from "../shared/types.js";
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

// Blind test: a separate Muse Spark call sees ONLY the products in each basket
// (no reasons, no persona names) and must say which persona built each one.
// High accuracy means personas produce distinguishable purchasing behavior.
export async function runJudge(results: AgentResult[], personas: Persona[], live: boolean): Promise<JudgeResult> {
  const valid = results.filter((r) => !r.error);
  const shuffled = shuffle(valid);
  const labelOf = new Map(shuffled.map((r, i) => [LETTERS[i], r.personaId]));

  const personaText = personas.map((p) => `- ${p.id}: ${p.name}. ${p.decisionStyle} Priorities: ${p.priorities.join(", ")}.`).join("\n");
  const basketText = shuffled
    .map((r, i) => `Basket ${LETTERS[i]} (total $${r.total}):\n${r.items.map((it) => `  - ${it.brand} ${it.name}, ${it.category}, $${it.price}`).join("\n") || "  (empty)"}`)
    .join("\n\n");

  if (!live) return simulatedJudge(valid, labelOf);

  const blindPrompt = `You are evaluating a consumer behavior experiment. Several shopping agents with different personas each built a basket from the same catalog, budget and trend feed. You see only what they bought.

Personas:
${personaText}

${basketText}

Assign each basket to exactly one persona id. Each persona is used at most once. Reply with JSON only:
{"assignments":[{"basket":"A","persona_id":"...","rationale":"one sentence"}]}`;

  const fidelityPrompt = `Score how faithfully each shopping agent behaved like its assigned persona, from 0 to 10, using its purchases and its own stated reasons.

${valid
  .map((r) => {
    const p = personas.find((x) => x.id === r.personaId)!;
    return `${p.id} (${p.name}: ${p.decisionStyle})\nBasket $${r.total}:\n${r.items.map((it) => `  - ${it.brand} ${it.name} $${it.price}. Reason: ${it.reason}`).join("\n") || "  (empty)"}\nResearch: ${r.stats.searches} searches, ${r.stats.productsInspected} products inspected, ${r.stats.trendChecks} trend checks, ${r.stats.alternativesChecked} alternative lookups.`;
  })
  .join("\n\n")}

Reply with JSON only:
{"fidelity":[{"persona_id":"...","score":0,"note":"one sentence"}],"headline":"one sentence on the most interesting behavioral difference across personas"}`;

  const [blindRes, fidRes] = await Promise.all([
    llm().chat.completions.create({ model: MODEL_ID, messages: [{ role: "user", content: blindPrompt }] }),
    llm().chat.completions.create({ model: MODEL_ID, messages: [{ role: "user", content: fidelityPrompt }] }),
  ]);
  const blind = extractJson<{ assignments: { basket: string; persona_id: string; rationale: string }[] }>(blindRes.choices[0]?.message?.content ?? "");
  const fid = extractJson<{ fidelity: { persona_id: string; score: number; note: string }[]; headline: string }>(fidRes.choices[0]?.message?.content ?? "");

  const assignments = blind.assignments.map((a) => {
    const actual = labelOf.get(a.basket) ?? "";
    return { basket: a.basket, guessedPersonaId: a.persona_id, actualPersonaId: actual, correct: a.persona_id === actual, rationale: a.rationale };
  });
  return {
    assignments,
    accuracy: assignments.length ? assignments.filter((a) => a.correct).length / assignments.length : 0,
    fidelity: fid.fidelity.map((f) => ({ personaId: f.persona_id, score: Number(f.score), note: f.note })),
    headline: fid.headline,
  };
}

function simulatedJudge(valid: AgentResult[], labelOf: Map<string, string>): JudgeResult {
  const assignments = [...labelOf.entries()].map(([basket, actual]) => ({
    basket,
    guessedPersonaId: actual,
    actualPersonaId: actual,
    correct: true,
    rationale: "Simulation mode: no model judge was called.",
  }));
  return {
    assignments,
    accuracy: 1,
    fidelity: valid.map((r) => ({ personaId: r.personaId, score: 0, note: "Simulation mode: add MODEL_API_KEY to score with Muse Spark." })),
    headline: "Simulation mode: scripted agents and no judge. Add MODEL_API_KEY to run the real experiment on Muse Spark.",
  };
}
