export type Category =
  | "cleanser"
  | "serum"
  | "moisturizer"
  | "sunscreen"
  | "lip"
  | "complexion"
  | "cheek"
  | "eyes"
  | "body";

export type Tier = "value" | "mid" | "prestige" | "luxury";

export interface Product {
  id: string;
  brand: string;
  name: string;
  category: Category;
  price: number;
  size: string;
  tier: Tier;
  keyIngredients: string[];
  claims: string[];
  rating: number; // simulated
  reviewCount: number; // simulated
  reviewPros: string;
  reviewCons: string;
  viralScore: number; // 0-100, simulated social buzz
  dupeOf?: string; // id of the product this is commonly called a dupe of
}

export interface TrendSignal {
  id: string;
  platform: "TikTok" | "Instagram" | "YouTube" | "Reddit";
  creator: string;
  headline: string;
  productIds: string[];
  sentiment: "hype" | "positive" | "mixed" | "skeptical";
  engagement: string;
}

export interface Traits {
  trend: number; // 0-100 how much social buzz sways them
  price: number; // 0-100 price sensitivity
  research: number; // 0-100 research depth
  prestige: number; // 0-100 pull of luxury / heritage brands
}

// A shopper persona as configured by the user. Defaults live in server/data/personas.ts.
export interface PersonaConfig {
  id: string;
  name: string;
  tagline: string;
  style: string; // free-text description of how they shop, second person
  color: string;
  traits: Traits;
}

export type Influence = "trend" | "reviews" | "ingredients" | "price" | "brand_prestige" | "dupe";

export interface BasketItem {
  productId: string;
  brand: string;
  name: string;
  price: number;
  category: Category;
  tier: Tier;
  reason: string;
  influence: Influence;
  listItem?: string; // which shopping-list item this fills (scenario runs)
  evidence?: "product page" | "new tab" | "quicklook" | "results tile"; // where the shopper's information came from
}

// Layer 2: who is shopping. Supplied per session, never stored on a persona.
export interface ConsumerContext {
  country?: string;
  city?: string;
  disposable_income?: "low" | "middle" | "high";
  personal_requirements?: string;
  lifestyle?: string;
}

// Layer 3: what this shopping trip is. Supplied per session.
export interface ShoppingMission {
  retailer: string;
  budget: number;
  currency: string;
  product_categories: Category[];
  occasion?: string;
  objective: string;
  scenario_id?: string;
  situation?: string;
  shopping_list?: { item: string; priority: "must" | "preferred" | "nice"; category: Category }[];
}

export interface ExperimentConfig {
  objective: string;
  budget: number;
  personas: PersonaConfig[];
  context: ConsumerContext;
  mission: ShoppingMission;
  maxSteps?: number;
}

// Shopper as used in a run: which persona layer it came from.
export interface RunShopper extends PersonaConfig {
  source: "locked" | "provisional";
  version: number | null;
}

export type AgentEvent =
  | { type: "status"; agent: string; status: "running" | "done" | "error"; message?: string }
  | { type: "thought"; agent: string; text: string }
  | { type: "tool"; agent: string; tool: string; args: Record<string, unknown>; summary: string }
  | { type: "basket"; agent: string; items: BasketItem[]; total: number }
  | { type: "final"; agent: string; summary: string };

export interface AgentStats {
  steps: number;
  searches: number;
  productsInspected: number;
  trendChecks: number;
  alternativesChecked: number;
  removals: number;
  // Live-site (browser) runs only.
  clicks?: number;
  typing?: number;
  scrolls?: number;
  pageViews?: number;
  comparisons?: number;
  rejections?: number;
}

// One entry in a browser run's activity timeline.
export interface ActivityEntry {
  t: number; // seconds since the run started
  kind: "search" | "click" | "type" | "keypress" | "scroll" | "drag" | "page_view" | "product_view" | "compare" | "reject" | "add" | "remove" | "finish" | "blocked_page" | "site_blocked" | "read_page" | "open_fallback" | "new_tab" | "decide_step" | "plan" | "thought" | "safety_ack" | "safety_stop" | "error";
  detail: string;
  reason?: string;
  url?: string;
}

export interface AgentResult {
  personaId: string;
  items: BasketItem[];
  total: number;
  summary: string;
  stats: AgentStats;
  activity?: ActivityEntry[];
  skipped?: { item: string; reason: string }[]; // shopping-list items not bought (scenario runs)
  settings?: object; // conditions this run used (live-site runs)
  blocked?: boolean; // the store refused pages and the run stopped
  signature?: import("./consistency").BehaviorSignature;
  plan?: ShopPlan; // how the shopper decided to shop, made at the start of the session
  error?: string;
}

// The shopper's own plan, made as the persona before browsing.
export interface ShopPlan {
  entry: "search_box" | "category_menu" | "bestsellers" | "new_arrivals" | "sale";
  entry_reason: string;
  search_style: "generic_then_filter" | "attribute_led" | "brand_or_product_known" | "mixed";
  style_reason: string;
  items: { list_item: string; first_move: string; evidence_needed: string; options_to_compare: number }[];
}

export interface JudgeResult {
  simulated: boolean;
  assignments: { basket: string; guessedPersonaId: string; actualPersonaId: string; correct: boolean; rationale: string }[];
  accuracy: number; // purchase-only blind test
  // Blind test on purchases plus reasons and shopping activity (persona names redacted).
  behavior?: { assignments: { basket: string; guessedPersonaId: string; actualPersonaId: string; correct: boolean; rationale: string }[]; accuracy: number };
  fidelity: { personaId: string; score: number; goalFit: number; note: string }[];
  headline: string;
}

export type StreamMessage =
  | { kind: "meta"; mode: "live" | "simulation"; model: string; runId: string; shoppers: RunShopper[]; context: ConsumerContext; mission: ShoppingMission; environment?: string; simulationId?: string }
  | { kind: "event"; event: AgentEvent }
  | { kind: "results"; results: AgentResult[] }
  | { kind: "judge"; judge: JudgeResult }
  | { kind: "judge_error"; message: string }
  | { kind: "done" };
