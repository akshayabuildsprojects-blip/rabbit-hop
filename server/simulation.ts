// Scripted agents used only when MODEL_API_KEY is not set, so the UI can be
// developed and tested offline. Live runs always use Muse Spark (agent.ts).
import type { AgentEvent, AgentResult, ExperimentConfig, PersonaConfig, Product } from "../shared/types.js";
import { CATALOG, productById } from "./data/catalog.js";
import { TRENDS } from "./data/trends.js";
import { ShoppingSession } from "./tools.js";

type Emit = (e: AgentEvent) => void;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runSimulatedAgent(persona: PersonaConfig, cfg: ExperimentConfig, emit: Emit): Promise<AgentResult> {
  const s = new ShoppingSession(cfg.budget);
  const call = async (thought: string, tool: string, args: Record<string, unknown>) => {
    await wait(350 + Math.random() * 500);
    s.stats.steps++;
    emit({ type: "thought", agent: persona.id, text: thought });
    const { summary } = s.run(tool, args);
    emit({ type: "tool", agent: persona.id, tool, args, summary });
    if (tool === "add_to_basket") emit({ type: "basket", agent: persona.id, items: [...s.items], total: s.total });
  };
  const fits = (p: Product) => s.total + p.price <= cfg.budget && !s.items.some((i) => i.productId === p.id);
  const usedCats = () => new Set(s.items.map((i) => i.category));

  // Pick a scripted strategy from the persona's strongest trait.
  const t = persona.traits;
  const strategy = ([["trend", t.trend], ["research", t.research], ["price", t.price], ["prestige", t.prestige]] as const)
    .slice()
    .sort((a, b) => b[1] - a[1])[0][0];

  switch (strategy) {
    case "trend": {
      await call("First stop, the feed. What is everyone obsessed with this week?", "view_trend_feed", {});
      await call("Sorting by buzz so I can grab the viral stuff before it sells out.", "search_catalog", { sort: "viral" });
      const viral = CATALOG.slice().sort((a, b) => b.viralScore - a.viralScore);
      for (const p of viral) {
        if (fits(p) && !usedCats().has(p.category) && !p.dupeOf) {
          await call(`${p.name} is all over my FYP, adding it.`, "add_to_basket", { product_id: p.id, reason: `Everyone on TikTok is using it and the results look amazing on camera.`, main_influence: "trend" });
        }
        if (s.items.length >= 5) break;
      }
      break;
    }
    case "research": {
      await call("Starting with the highest-rated products, not the loudest ones.", "search_catalog", { sort: "rating" });
      for (const cat of ["sunscreen", "moisturizer", "serum", "cleanser", "lip"] as const) {
        const options = CATALOG.filter((p) => p.category === cat).sort((a, b) => b.rating / Math.log(b.price + 5) - a.rating / Math.log(a.price + 5));
        await call(`Comparing ${cat} formulas.`, "search_catalog", { category: cat, sort: "rating" });
        for (const p of options.slice(0, 2)) await call(`Checking the ingredients and review cons for ${p.name}.`, "get_product_details", { product_id: p.id });
        const pick = options.find(fits);
        if (pick) await call(`${pick.name} has the best evidence per dollar.`, "add_to_basket", { product_id: pick.id, reason: `Strong ${pick.keyIngredients[0]} formula and consistent reviews.`, main_influence: "ingredients" });
      }
      break;
    }
    case "price": {
      await call("Checking what is viral so I know what to dupe.", "view_trend_feed", {});
      const viralIds = [...new Set(TRENDS.flatMap((t) => t.productIds))].map((id) => productById.get(id)!).filter((p) => !p.dupeOf);
      for (const p of viralIds) {
        await call(`${p.name} is $${p.price}. There has to be a cheaper version.`, "find_alternatives", { product_id: p.id });
        const dupe = CATALOG.find((x) => x.dupeOf === p.id);
        if (dupe && fits(dupe)) await call(`${dupe.name} does the same job for $${dupe.price}.`, "add_to_basket", { product_id: dupe.id, reason: `Same effect as ${p.brand} for ${Math.round((1 - dupe.price / p.price) * 100)}% less.`, main_influence: "dupe" });
        if (s.items.length >= 6) break;
      }
      break;
    }
    default: {
      await call("Looking only at the prestige end of the shelf.", "search_catalog", { sort: "price_desc" });
      const lux = CATALOG.filter((p) => p.tier === "luxury").sort((a, b) => b.rating - a.rating);
      for (const p of lux) {
        if (!fits(p) || usedCats().has(p.category)) continue;
        await call(`Considering ${p.brand}; checking texture and finish.`, "get_product_details", { product_id: p.id });
        await call(`${p.name} earns a place on my shelf.`, "add_to_basket", { product_id: p.id, reason: `Heritage brand with a beautiful ritual and finish.`, main_influence: "brand_prestige" });
        if (s.items.length >= 3) break;
      }
    }
  }
  await call("That is my basket.", "finalize_basket", { summary: `Scripted ${persona.name} basket (simulation mode, no model call).` });
  emit({ type: "final", agent: persona.id, summary: s.summary });
  return { personaId: persona.id, items: s.items, total: s.total, summary: s.summary, stats: s.stats };
}
