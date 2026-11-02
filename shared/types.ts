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

export interface Persona {
  id: string;
  name: string;
  tagline: string;
  color: string;
  priorities: string[];
  decisionStyle: string;
  systemPrompt: string;
}

export type Influence =
  | "trend"
  | "reviews"
  | "ingredients"
  | "price"
  | "brand_prestige"
  | "dupe";

export interface BasketItem {
  productId: string;
  brand: string;
  name: string;
  price: number;
  category: Category;
  tier: Tier;
  reason: string;
  influence: Influence;
}

export interface ExperimentConfig {
  objective: string;
  budget: number;
  personaIds: string[];
  maxSteps?: number;
}

export type AgentEvent =
  | { type: "status"; agent: string; status: "running" | "done" | "error"; message?: string }
  | { type: "thought"; agent: string; text: string }
  | { type: "tool"; agent: string; tool: string; args: Record<string, unknown>; summary: string }
  | { type: "basket"; agent: string; items: BasketItem[]; total: number }
  | { type: "final"; agent: string; summary: string };

export interface AgentResult {
  personaId: string;
  items: BasketItem[];
  total: number;
  summary: string;
  stats: {
    steps: number;
    searches: number;
    productsInspected: number;
    trendChecks: number;
    alternativesChecked: number;
    removals: number;
  };
  error?: string;
}

export interface JudgeResult {
  assignments: { basket: string; guessedPersonaId: string; actualPersonaId: string; correct: boolean; rationale: string }[];
  accuracy: number;
  fidelity: { personaId: string; score: number; note: string }[];
  headline: string;
}

export type StreamMessage =
  | { kind: "meta"; mode: "live" | "simulation"; model: string; runId: string }
  | { kind: "event"; event: AgentEvent }
  | { kind: "results"; results: AgentResult[] }
  | { kind: "judge"; judge: JudgeResult }
  | { kind: "judge_error"; message: string }
  | { kind: "done" };
