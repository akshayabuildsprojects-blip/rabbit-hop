import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { digestHistory, historyLines, parseCsv, PRIOR_COLUMNS, readPriorCsv } from "../shared/priorData";
import { browserInstructions, planInstructions, RETAILER_SITES } from "../server/browser/shopAgent";

const dir = path.resolve(__dirname, "../data/prior-data");
const files = fs.readdirSync(dir).filter((f) => f.endsWith("-history.csv"));

describe("prior data", () => {
  it("parses quoted fields, commas and escaped quotes", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });

  it("every archetype history has 100 valid rows in the full format and allowed origins", () => {
    expect(files).toHaveLength(5);
    for (const f of files) {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      expect(parseCsv(text)[0]).toEqual([...PRIOR_COLUMNS]);
      const { rows, error } = readPriorCsv(text);
      expect(error).toBeUndefined();
      expect(rows).toHaveLength(100);
      for (const r of rows) expect(["US", "UK", "French", "K-beauty", "J-beauty", "Thai", "Indian"]).toContain(r.origin);
    }
  });

  it("rejects files without brand and product columns", () => {
    expect(readPriorCsv("name,price\nx,1\n").error).toMatch(/Missing columns: brand, product/);
  });

  it("summarizes a history and puts it in Muse's instructions: full in the plan, summary while shopping", () => {
    const { rows } = readPriorCsv(fs.readFileSync(path.join(dir, "luxury-history.csv"), "utf8"));
    const digest = digestHistory(rows);
    expect(digest).toMatch(/100 past purchases/);
    expect(digest).toMatch(/Chanel/);
    expect(digest).toMatch(/Returned:/);
    const persona: any = { id: "luxury", name: "Luxury Beauty Shopper", style: "Prefers prestige." };
    const cfg: any = { context: {}, mission: { budget: 150, objective: "x", product_categories: [] } };
    const h = { source: "archetype" as const, fileName: "luxury-history.csv", rows };
    const plan = planInstructions(persona, cfg, RETAILER_SITES.sephora, h);
    expect(plan).toContain(historyLines(rows).split("\n")[0]);
    expect(plan).toContain("This is your shopping history");
    const browse = browserInstructions(persona, cfg, RETAILER_SITES.sephora, undefined, h);
    expect(browse).toContain(digest);
    expect(browse).not.toContain(historyLines(rows).split("\n")[0]);
    expect(browserInstructions(persona, cfg, RETAILER_SITES.sephora)).not.toContain("shopping history");
  });
});
