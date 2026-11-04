import { z } from "zod";

// Three layers, kept separate on purpose:
//   1. Core persona     (schema.ts)  persistent shopping psychology, priorities, decision rules. Locked.
//   2. Consumer context (this file)  who is shopping: income, location, requirements, lifestyle. Per session.
//   3. Shopping mission (this file)  what this trip is: retailer, budget, categories, occasion, objective. Per session.
// The same locked persona can be simulated in Singapore or the US, on any budget, for any mission.

export const ConsumerContextSchema = z
  .object({
    country: z.string().max(60).optional(),
    city: z.string().max(60).optional(),
    disposable_income: z.enum(["low", "middle", "high"]).optional(),
    personal_requirements: z.string().max(400).optional(), // e.g. "fragrance-free", "vegan only", "oily skin"
    lifestyle: z.string().max(400).optional(), // e.g. "commutes daily, gym four times a week"
  })
  .strict();
export type ConsumerContext = z.infer<typeof ConsumerContextSchema>;

export const PRODUCT_CATEGORIES = ["cleanser", "serum", "moisturizer", "sunscreen", "lip", "complexion", "cheek", "eyes", "body"] as const;

export const ShoppingMissionSchema = z
  .object({
    retailer: z.string().min(2).max(80),
    budget: z.number().min(20).max(1000),
    currency: z.string().length(3).default("USD"),
    product_categories: z.array(z.enum(PRODUCT_CATEGORIES)).default([]),
    occasion: z.string().max(120).optional(),
    objective: z.string().min(3).max(400),
    // Set when the mission comes from a curated scenario.
    scenario_id: z.string().max(60).optional(),
    situation: z.string().max(300).optional(),
    shopping_list: z
      .array(z.object({ item: z.string().min(1).max(60), priority: z.enum(["must", "preferred", "nice"]), category: z.enum(PRODUCT_CATEGORIES) }).strict())
      .max(8)
      .optional(),
  })
  .strict();
export type ShoppingMission = z.infer<typeof ShoppingMissionSchema>;

// Keys that describe context or mission rather than behavior. They must never appear in a persona profile.
export const CONTEXT_KEYS = [
  "age",
  "age_band",
  "income",
  "disposable_income",
  "budget",
  "shopping_budget",
  "currency",
  "location",
  "country",
  "city",
  "region",
  "retailer",
  "occasion",
  "shopping_occasion",
  "objective",
  "product_categories",
  "climate",
  "season",
  "skin_type",
  "personal_requirements",
  "lifestyle",
];

export function describeContext(c: ConsumerContext): string {
  const lines = [
    c.country || c.city ? `- Location: ${[c.city, c.country].filter(Boolean).join(", ")}` : "",
    c.disposable_income ? `- Disposable income: ${c.disposable_income}` : "",
    c.personal_requirements ? `- Personal requirements: ${c.personal_requirements}` : "",
    c.lifestyle ? `- Lifestyle: ${c.lifestyle}` : "",
  ].filter(Boolean);
  return lines.length ? lines.join("\n") : "- No specific consumer context given.";
}

const PRIORITY_TEXT = { must: "must have", preferred: "highly preferred", nice: "nice to have" } as const;

export function describeMission(m: ShoppingMission): string {
  if (m.shopping_list?.length) {
    return [
      `- Budget: $${m.budget} (hard limit; ignore tax and shipping)`,
      `- Why you are shopping: ${m.situation ?? m.objective}`,
      `- Shopping list, in priority order (shop it top-down):`,
      ...m.shopping_list.map((i, n) => `  ${n + 1}. ${i.item} (${PRIORITY_TEXT[i.priority]})`),
      `- Must have: buy one, or explain why nothing was acceptable. Highly preferred: buy one unless the budget or your standards rule every option out. Nice to have: only if budget and a good option remain. You do not have to buy everything, and you must not buy items outside the list.`,
      `- Retailer: ${m.retailer}`,
    ].join("\n");
  }
  return [
    `- Objective: ${m.objective}`,
    `- Retailer: ${m.retailer}`,
    `- Budget: ${m.budget} ${m.currency} (hard limit; ignore tax and shipping)`,
    m.product_categories.length ? `- Product categories in scope: ${m.product_categories.join(", ")}` : "- Product categories: any",
    m.occasion ? `- Occasion: ${m.occasion}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
