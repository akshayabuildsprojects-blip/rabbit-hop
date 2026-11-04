import { describe, expect, it } from "vitest";
import { behaviorText, redact } from "../server/judge.js";

const personas: any[] = [{ id: "luxury", name: "Luxury Beauty Shopper", tagline: "", style: "", color: "", traits: {} }];

describe("judge inputs", () => {
  it("redacts persona names and self-labels", () => {
    expect(redact("As a Luxury Beauty Shopper I want this; luxury pick.", personas)).not.toMatch(/luxury beauty shopper/i);
    expect(redact("as a value-focused shopper I compared", personas)).toBe("as [persona] I compared");
  });
  it("includes reasons and the activity timeline", () => {
    const t = behaviorText(
      {
        personaId: "luxury", total: 38, summary: "One hero item.",
        items: [{ productId: "u", brand: "Lux", name: "Glow Tint", price: 38, category: "complexion", tier: "prestige", reason: "Luminous finish", influence: "brand_prestige" }],
        stats: { steps: 3, searches: 1, productsInspected: 2, trendChecks: 0, alternativesChecked: 0, removals: 0, clicks: 4, comparisons: 1, rejections: 1 },
        activity: [{ t: 5, kind: "reject", detail: "Matte Base", reason: "Packaging feels cheap" }],
      },
      personas,
    );
    expect(t).toContain("Reason: Luminous finish");
    expect(t).toContain("4 clicks");
    expect(t).toContain("reject: Matte Base (reason: Packaging feels cheap)");
  });
});
