import type { BasketItem, Category, Influence, Product } from "../shared/types.js";
import { CATALOG, productById, SEPHORA_SEARCH } from "./data/catalog.js";
import { TRENDS } from "./data/trends.js";

const CATEGORIES: Category[] = ["cleanser", "serum", "moisturizer", "sunscreen", "lip", "complexion", "cheek", "eyes", "body"];
const INFLUENCES: Influence[] = ["trend", "reviews", "ingredients", "price", "brand_prestige", "dupe"];

// OpenAI-compatible tool schemas, accepted by Meta Model API chat completions.
export const TOOL_DEFS = [
  {
    type: "function" as const,
    function: {
      name: "view_trend_feed",
      description: "See what is trending in beauty right now across TikTok, Instagram, YouTube and Reddit. Returns posts with the products they mention.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_catalog",
      description: "Search the store catalog. All filters are optional. Returns short product summaries with ids.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free text matched against brand, name, ingredients and claims" },
          category: { type: "string", enum: CATEGORIES },
          max_price: { type: "number" },
          sort: { type: "string", enum: ["price_asc", "price_desc", "rating", "viral"] },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_product_details",
      description: "Full details for one product: ingredients, claims, rating, review pros and cons, and buzz score.",
      parameters: {
        type: "object",
        properties: { product_id: { type: "string" } },
        required: ["product_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find_alternatives",
      description: "Find cheaper or comparable alternatives (including known dupes) for a product.",
      parameters: {
        type: "object",
        properties: { product_id: { type: "string" } },
        required: ["product_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "add_to_basket",
      description: "Add a product to your basket. Fails if it would exceed your budget.",
      parameters: {
        type: "object",
        properties: {
          product_id: { type: "string" },
          reason: { type: "string", description: "One sentence, in your own voice, on why you chose it" },
          main_influence: { type: "string", enum: INFLUENCES, description: "The single biggest factor in this decision" },
        },
        required: ["product_id", "reason", "main_influence"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "remove_from_basket",
      description: "Remove a product from your basket.",
      parameters: {
        type: "object",
        properties: { product_id: { type: "string" }, reason: { type: "string" } },
        required: ["product_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "finalize_basket",
      description: "Check out. Call once when your basket is final.",
      parameters: {
        type: "object",
        properties: { summary: { type: "string", description: "Two sentences in your own voice describing your basket and strategy" } },
        required: ["summary"],
        additionalProperties: false,
      },
    },
  },
];

const brief = (p: Product) => ({
  id: p.id,
  brand: p.brand,
  name: p.name,
  category: p.category,
  price: p.price,
  rating: p.rating,
  buzz: p.viralScore,
});

export class ShoppingSession {
  items: BasketItem[] = [];
  finalized = false;
  summary = "";
  stats = { steps: 0, searches: 0, productsInspected: 0, trendChecks: 0, alternativesChecked: 0, removals: 0 };

  constructor(public budget: number) {}

  get total() {
    return Math.round(this.items.reduce((s, i) => s + i.price, 0) * 100) / 100;
  }

  run(name: string, args: Record<string, any>): { result: unknown; summary: string } {
    switch (name) {
      case "view_trend_feed": {
        this.stats.trendChecks++;
        return { result: TRENDS, summary: `Scrolled the trend feed (${TRENDS.length} posts)` };
      }
      case "search_catalog": {
        this.stats.searches++;
        let list = CATALOG.slice();
        if (args.category) list = list.filter((p) => p.category === args.category);
        if (typeof args.max_price === "number") list = list.filter((p) => p.price <= args.max_price);
        if (args.query) {
          const terms = String(args.query).toLowerCase().split(/\s+/).filter(Boolean);
          const hay = (p: Product) => [p.brand, p.name, p.category, ...p.keyIngredients, ...p.claims].join(" ").toLowerCase();
          const scored = list.map((p) => ({ p, s: terms.filter((t) => hay(p).includes(t)).length })).filter((x) => x.s > 0);
          list = scored.sort((a, b) => b.s - a.s).map((x) => x.p);
        }
        const sorters: Record<string, (a: Product, b: Product) => number> = {
          price_asc: (a, b) => a.price - b.price,
          price_desc: (a, b) => b.price - a.price,
          rating: (a, b) => b.rating - a.rating,
          viral: (a, b) => b.viralScore - a.viralScore,
        };
        if (args.sort && sorters[args.sort]) list.sort(sorters[args.sort]);
        const label = [args.query && `"${args.query}"`, args.category, args.max_price && `under $${args.max_price}`].filter(Boolean).join(", ") || "everything";
        return { result: list.slice(0, 10).map(brief), summary: `Searched ${label}: ${list.length} results` };
      }
      case "get_product_details": {
        const p = productById.get(args.product_id);
        if (!p) return { result: { error: "Unknown product_id" }, summary: `Looked up unknown product ${args.product_id}` };
        this.stats.productsInspected++;
        const mentions = TRENDS.filter((t) => t.productIds.includes(p.id)).map((t) => `${t.platform} ${t.creator}: ${t.headline}`);
        return { result: { ...p, socialMentions: mentions }, summary: `Inspected ${p.brand} ${p.name}` };
      }
      case "find_alternatives": {
        const p = productById.get(args.product_id);
        if (!p) return { result: { error: "Unknown product_id" }, summary: `Alternatives for unknown ${args.product_id}` };
        this.stats.alternativesChecked++;
        const dupes = CATALOG.filter((x) => x.dupeOf === p.id);
        const original = p.dupeOf ? productById.get(p.dupeOf) : undefined;
        const sameCat = CATALOG.filter((x) => x.category === p.category && x.id !== p.id && !dupes.includes(x) && x !== original)
          .sort((a, b) => a.price - b.price)
          .slice(0, 3);
        return {
          result: {
            knownDupes: dupes.map(brief),
            originalItDupes: original ? brief(original) : null,
            otherOptions: sameCat.map(brief),
          },
          summary: `Checked alternatives to ${p.brand} ${p.name}${dupes.length ? ` (${dupes.length} known dupe)` : ""}`,
        };
      }
      case "add_to_basket": {
        const p = productById.get(args.product_id);
        if (!p) return { result: { ok: false, error: "Unknown product_id" }, summary: `Tried to add unknown ${args.product_id}` };
        if (this.items.some((i) => i.productId === p.id)) return { result: { ok: false, error: "Already in basket" }, summary: `${p.name} already in basket` };
        if (this.total + p.price > this.budget + 0.001) {
          return {
            result: { ok: false, error: `Over budget. Basket $${this.total}, item $${p.price}, budget $${this.budget}. Remove something or choose a cheaper item.` },
            summary: `Blocked: ${p.brand} ${p.name} would exceed budget`,
          };
        }
        const influence: Influence = INFLUENCES.includes(args.main_influence) ? args.main_influence : "reviews";
        this.items.push({ productId: p.id, brand: p.brand, name: p.name, price: p.price, category: p.category, tier: p.tier, reason: String(args.reason ?? ""), influence });
        return {
          result: { ok: true, basketTotal: this.total, remaining: Math.round((this.budget - this.total) * 100) / 100, link: SEPHORA_SEARCH(p) },
          summary: `Added ${p.brand} ${p.name} ($${p.price})`,
        };
      }
      case "remove_from_basket": {
        const idx = this.items.findIndex((i) => i.productId === args.product_id);
        if (idx < 0) return { result: { ok: false, error: "Not in basket" }, summary: `Tried to remove ${args.product_id}` };
        const [removed] = this.items.splice(idx, 1);
        this.stats.removals++;
        return { result: { ok: true, basketTotal: this.total }, summary: `Removed ${removed.brand} ${removed.name}` };
      }
      case "finalize_basket": {
        this.finalized = true;
        this.summary = String(args.summary ?? "");
        return { result: { ok: true, total: this.total, items: this.items.length }, summary: `Checked out ${this.items.length} items for $${this.total}` };
      }
      default:
        return { result: { error: `Unknown tool ${name}` }, summary: `Unknown tool ${name}` };
    }
  }
}
