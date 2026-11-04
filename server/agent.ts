import type { AgentEvent, AgentResult, ExperimentConfig, PersonaConfig } from "../shared/types.js";
import { describeTraits } from "./personas/traits.js";
import { describeContext, describeMission } from "./personas/context.js";
import { llm, MODEL_ID } from "./llm.js";
import { ShoppingSession, TOOL_DEFS } from "./tools.js";

type Emit = (e: AgentEvent) => void;

export function buildSystemPrompt(persona: PersonaConfig, cfg: ExperimentConfig) {
  return `You are a shopper persona called "${persona.name}".${persona.tagline ? ` Your motto: "${persona.tagline}"` : ""}
${persona.style || "Shop according to the trait dials below."}

Your trait dials (these should visibly shape your choices):
${describeTraits(persona.traits)}

Consumer context for this session (who you are shopping as today):
${describeContext(cfg.context)}

Shopping mission for this session:
${describeMission(cfg.mission)}

You are an autonomous shopping agent in a beauty store. Your persona decides HOW you shop; the context and mission decide the circumstances.

How to work:
- Use the tools to explore the trend feed and catalog, compare options and build your basket. Only buy products by their catalog id.
- Stay fully in character. Your persona decides what you look at first, what evidence you trust, and what you are willing to pay for.
- Before each tool call, write one short first-person sentence (under 20 words) saying what you are doing and why.
- You may call several tools at once when it makes sense.
- When your basket is final, call finalize_basket. Try to finish within about 12 tool calls.`;
}

export async function runLiveAgent(persona: PersonaConfig, cfg: ExperimentConfig, emit: Emit, signal: AbortSignal): Promise<AgentResult> {
  const session = new ShoppingSession(cfg.budget);
  const maxSteps = cfg.maxSteps ?? 16;
  const messages: any[] = [
    { role: "system", content: buildSystemPrompt(persona, cfg) },
    { role: "user", content: "Start shopping now." },
  ];

  for (let step = 0; step < maxSteps && !session.finalized; step++) {
    if (signal.aborted) throw new Error("Cancelled");
    session.stats.steps++;
    const res = await llm().chat.completions.create(
      { model: MODEL_ID, messages, tools: TOOL_DEFS as any, tool_choice: "auto" },
      { signal },
    );
    const msg: any = res.choices[0]?.message;
    if (!msg) break;
    const text = typeof msg.content === "string" ? msg.content.trim() : "";
    if (text) emit({ type: "thought", agent: persona.id, text });

    const calls: any[] = msg.tool_calls ?? [];
    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls.length ? calls : undefined });

    if (!calls.length) {
      messages.push({ role: "user", content: "Continue using the tools. Call finalize_basket when your basket is final." });
      continue;
    }

    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      const { result, summary } = session.run(call.function.name, args);
      emit({ type: "tool", agent: persona.id, tool: call.function.name, args, summary });
      if (call.function.name === "add_to_basket" || call.function.name === "remove_from_basket") {
        emit({ type: "basket", agent: persona.id, items: [...session.items], total: session.total });
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  if (!session.finalized) session.summary = "Ran out of steps before checking out; basket shown as it stood.";
  emit({ type: "final", agent: persona.id, summary: session.summary });
  return { personaId: persona.id, items: session.items, total: session.total, summary: session.summary, stats: session.stats };
}
