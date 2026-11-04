import type { Traits } from "../../shared/types.js";

const level = (v: number) => (v >= 80 ? "very high" : v >= 60 ? "high" : v >= 40 ? "moderate" : v >= 20 ? "low" : "very low");

export function describeTraits(t: Traits) {
  return [
    `- Trend influence: ${level(t.trend)} (${t.trend}/100). How much social buzz, creators and virality sway you.`,
    `- Price sensitivity: ${level(t.price)} (${t.price}/100). How hard you push for lower prices and dupes.`,
    `- Research depth: ${level(t.research)} (${t.research}/100). How much you inspect details and reviews before buying.`,
    `- Prestige pull: ${level(t.prestige)} (${t.prestige}/100). How strongly heritage and luxury brands attract you.`,
  ].join("\n");
}
