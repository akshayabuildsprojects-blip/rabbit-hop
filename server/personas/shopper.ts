import type { PersonaConfig, Traits } from "../../shared/types.js";
import { getDefinition } from "./registry.js";
import { PersonaStore, PersonaNotFoundError } from "./store.js";
import { BEHAVIOR_KEYS, type PersonaDefinition, type PersonaProfile } from "./schema.js";

// Trait dials used ONLY when an archetype has not been researched and locked yet, so the
// experiment and the offline simulation still run. Locked profiles replace these entirely.
const PROVISIONAL_TRAITS: Record<string, Traits> = {
  "trend-driven": { trend: 85, price: 40, research: 25, prestige: 40 },
  "sensitive-skin": { trend: 20, price: 45, research: 90, prestige: 30 },
  "time-constrained": { trend: 40, price: 35, research: 35, prestige: 50 },
  "price-sensitive": { trend: 55, price: 95, research: 60, prestige: 10 },
  luxury: { trend: 40, price: 10, research: 55, prestige: 95 },
};

const pct = (n: number) => Math.round(n * 100);

// Renders a locked profile as the behavioral brief an agent reads. Contains behavior only:
// context and mission are added separately per session.
export function profileToBrief(p: PersonaProfile): string {
  const sb = p.shopping_behavior;
  const list = (xs: string[]) => xs.map((x) => `  - ${x}`).join("\n");
  return `Locked behavioral profile v${p.metadata.version} (${p.metadata.content_hash}). Follow it; do not drift from it.

${p.description}
Primary motivation: ${p.primary_motivation}

Behavioral parameters, 0 to 1 (simulation settings):
${BEHAVIOR_KEYS.map((k) => `  - ${k}: ${p.behavioral_parameters[k].toFixed(2)}`).join("\n")}

Preferred discovery channels:
${list(sb.preferred_discovery_channels)}
Trusted information sources, in priority order:
${list(sb.trusted_information_sources)}
How you evaluate products:
${list(sb.product_evaluation_criteria)}
What makes you buy:
${list(sb.purchase_triggers)}
What makes you reject a product:
${list(sb.rejection_criteria)}
How you compare alternatives: ${sb.comparison_strategy}
Your typical shopping sequence:
${sb.typical_shopping_sequence.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}

Decision rules:
${p.decision_rules.map((r) => `  - ${r.rule}`).join("\n")}${
    p.shopping_decision_rules?.length
      ? `\n\nHow you handle common situations (react to the evidence you actually see; none of these is a fixed outcome):\n${p.shopping_decision_rules
          .map((r) => `  - ${r.scenario_id.replace(/_/g, " ")}: first ${r.investigate_first} Weigh: ${r.conflict_weighing} Buy if: ${r.purchase_triggers.join("; ")}. Reject if: ${r.rejection_triggers.join("; ")}.`)
          .join("\n")}`
      : ""
  }`;
}

export interface ResolvedShopper {
  config: PersonaConfig;
  source: "locked" | "provisional";
  version: number | null;
}

export function resolveShopper(dataDir: string, id: string): ResolvedShopper {
  const def: PersonaDefinition = getDefinition(dataDir, id);
  const store = new PersonaStore(dataDir);
  const color = def.ui_color ?? "#CCCCCC";
  if (store.hasLocked(def.persona_id)) {
    const p = store.loadLocked(def.persona_id); // verifies the content hash; read-only
    const b = p.behavioral_parameters;
    return {
      source: "locked",
      version: p.metadata.version,
      config: {
        id: def.persona_id,
        name: p.persona_name,
        tagline: p.primary_motivation,
        style: profileToBrief(p as PersonaProfile),
        color,
        traits: { trend: pct(b.trend_sensitivity), price: pct(b.price_sensitivity), research: pct(b.research_depth), prestige: pct(b.prestige_priority) },
      },
    };
  }
  return {
    source: "provisional",
    version: null,
    config: {
      id: def.persona_id,
      name: def.persona_name,
      tagline: def.baseline.motivation,
      style: `Provisional archetype: baseline hypotheses, not yet researched or locked.\nMotivation: ${def.baseline.motivation}\nCharacteristics:\n${def.baseline.characteristics.map((t) => `  - ${t}`).join("\n")}\nTypical shopping journey: ${def.baseline.shopping_journey.join(" → ")}`,
      color,
      traits: PROVISIONAL_TRAITS[def.persona_id] ?? { trend: 50, price: 50, research: 50, prestige: 50 },
    },
  };
}

export { PersonaNotFoundError };
