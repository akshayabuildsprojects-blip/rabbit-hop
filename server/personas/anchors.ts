import type { BEHAVIOR_KEYS } from "./schema.js";

type Key = (typeof BEHAVIOR_KEYS)[number];

// Shared score anchors so all five personas are read on the same scale.
// Scores are relative behavioral tendencies, not probabilities: 0.9 does not mean
// "follows this trait in 90% of decisions".
export const BANDS = {
  low: { min: 0, max: 0.35 },
  medium: { min: 0.35, max: 0.65 },
  high: { min: 0.65, max: 1 },
} as const;
export type Band = keyof typeof BANDS;

export const bandOf = (score: number): Band => (score < 0.35 ? "low" : score <= 0.65 ? "medium" : "high");

export const PARAMETER_ANCHORS: Record<Key, { definition: string; low: string; medium: string; high: string }> = {
  trend_sensitivity: {
    definition: "How strongly current trends, viral products and what is popular right now shape what the shopper looks at and wants.",
    low: "Largely ignores trends; picks by need or habit and is unmoved by 'trending' labels.",
    medium: "Notices trends and may check a trending item, but only pursues it if it fits a need.",
    high: "Actively seeks out what is trending; trend status is a primary reason to consider a product.",
  },
  influencer_trust: {
    definition: "How much weight the shopper gives to creators, influencers and celebrity endorsements versus other sources.",
    low: "Discounts creator endorsements; relies on reviews, experts or own experience instead.",
    medium: "Uses creator content as one input, usually checked against reviews or other sources.",
    high: "Treats trusted creators as a main source of truth; an endorsement can carry a decision.",
  },
  price_sensitivity: {
    definition: "How much price, discounts and cost per use influence consideration and choice.",
    low: "Price rarely changes the decision once a product is wanted.",
    medium: "Compares prices and notices deals, but pays more when the product is clearly better or more wanted.",
    high: "Price leads the decision; actively hunts deals, cheaper alternatives and dupes.",
  },
  brand_loyalty: {
    definition: "How much the shopper sticks with known brands versus switching.",
    low: "Switches brands freely; brand familiarity carries little weight.",
    medium: "Has some favorite brands but will switch for a compelling reason.",
    high: "Defaults to trusted brands and needs a strong reason to try another.",
  },
  research_depth: {
    definition: "How much information the shopper gathers before buying: reviews, ingredients, details, comparisons.",
    low: "Buys on a quick impression with little checking.",
    medium: "Checks a few signals (rating, some reviews, key details) before buying.",
    high: "Reads reviews and details thoroughly and compares several options before committing.",
  },
  novelty_seeking: {
    definition: "How attracted the shopper is to new launches, new brands and untried products.",
    low: "Prefers proven, familiar products; new launches are a reason for caution.",
    medium: "Open to new products when there is a reason to try them.",
    high: "Drawn to what is new; newness itself is a reason to consider a product.",
  },
  impulse_buying_tendency: {
    definition: "How likely the shopper is to buy something unplanned or decide quickly in the moment.",
    low: "Sticks to the planned purchase; rarely adds unplanned items.",
    medium: "Occasionally adds an unplanned item when it is appealing and low risk.",
    high: "Often adds unplanned items and decides quickly when something catches attention.",
  },
  product_quality_priority: {
    definition: "How much demonstrated performance and formulation quality drive the choice.",
    low: "Accepts adequate performance; quality is secondary to other drivers.",
    medium: "Wants products that work, balanced against price, trend or convenience.",
    high: "Performance and formulation quality are deciding factors.",
  },
  convenience_priority: {
    definition: "How much ease, speed, simplicity and fit with a routine matter.",
    low: "Willing to spend time and effort for the right product.",
    medium: "Prefers easy options but will make an effort when it is worth it.",
    high: "Chooses the easiest, fastest, most streamlined option; friction is a reason to reject.",
  },
  prestige_priority: {
    definition: "How much brand status, exclusivity, packaging and premium positioning matter.",
    low: "Indifferent to prestige; mass and drugstore-style brands are fine.",
    medium: "Appreciates premium touches but does not need them.",
    high: "Prefers prestige brands and premium presentation; prestige is part of the value.",
  },
};
