import { describe, expect, it } from "vitest";
import http from "node:http";
import { classifyUrl, mapKey, runBrowserAgent } from "../server/browser/shopAgent.js";

const PAGES: Record<string, string> = {
  "/": `<html><body style="margin:0"><a id="s" href="/search?keyword=foundation" style="display:block;width:300px;height:100px;background:#eee">Search foundation</a></body></html>`,
  "/search": `<html><body style="margin:0"><a href="/product/glow-tint-P123" style="display:block;width:300px;height:100px;background:#ddd">Glow Tint</a></body></html>`,
  "/product/glow-tint-P123": `<html><body><h1>Glow Tint $38</h1></body></html>`,
};

function server() {
  return new Promise<{ url: string; close: () => void }>((resolve) => {
    const s = http.createServer((req, res) => {
      const p = (req.url ?? "/").split("?")[0];
      res.setHeader("content-type", "text/html");
      res.end(PAGES[p] ?? "<html><body>not found</body></html>");
    });
    s.listen(0, () => resolve({ url: `http://127.0.0.1:${(s.address() as any).port}`, close: () => s.close() }));
  });
}

const persona: any = { id: "luxury", name: "Luxury Beauty Shopper", tagline: "x", style: "Prefers prestige.", color: "#000", traits: { trend: 50, price: 20, research: 80, prestige: 90 } };
const cfg: any = { objective: "Buy a foundation", budget: 60, personas: [persona], context: {}, mission: { retailer: "Sephora", budget: 60, currency: "USD", product_categories: ["complexion"], objective: "Buy a foundation" } };

describe("browser shopping agent", () => {
  it("classifies URLs and maps keys", () => {
    expect(classifyUrl("https://www.sephora.com/search?keyword=blush")).toEqual({ kind: "search", detail: "blush" });
    expect(classifyUrl("https://www.sephora.com/product/soft-pinch-liquid-blush-P97989778").kind).toBe("product_view");
    expect(mapKey("ENTER")).toBe("Enter");
  });

  it("runs the computer-use loop, executes clicks, logs activity and records decisions with reasons", async () => {
    const srv = await server();
    const calls: any[] = [];
    const script: any[] = [
      { id: "r1", output: [{ type: "message", content: [{ text: "I'll search for foundation." }] }, { type: "computer_call", call_id: "c1", actions: [{ type: "click", button: "left", x: 50, y: 50 }], pending_safety_checks: [] }] },
      { id: "r2", output: [{ type: "computer_call", call_id: "c2", actions: [{ type: "scroll", x: 100, y: 100, scroll_x: 0, scroll_y: 300 }, { type: "click", button: "left", x: 50, y: 50 }], pending_safety_checks: [] }] },
      {
        id: "r3",
        output: [
          { type: "function_call", call_id: "f1", name: "compare_products", arguments: JSON.stringify({ products: ["Glow Tint", "Matte Base"], winner: "Glow Tint", deciding_factor: "Finish and texture" }) },
          { type: "function_call", call_id: "f2", name: "reject_product", arguments: JSON.stringify({ product_name: "Matte Base", reason: "Packaging feels cheap" }) },
          { type: "function_call", call_id: "f3", name: "add_to_basket", arguments: JSON.stringify({ brand: "Lux", product_name: "Glow Tint", price_usd: 38, category: "complexion", tier: "prestige", reason: "Luminous finish", main_influence: "brand_prestige" }) },
          { type: "function_call", call_id: "f4", name: "add_to_basket", arguments: JSON.stringify({ brand: "Lux", product_name: "Big Serum", price_usd: 40, category: "serum", tier: "luxury", reason: "Want it", main_influence: "brand_prestige" }) },
        ],
      },
      { id: "r4", output: [{ type: "function_call", call_id: "f5", name: "finish_shopping", arguments: JSON.stringify({ summary: "One hero foundation." }) }] },
    ];
    const planCalls: any[] = [];
    const plan = { entry: "search_box", entry_reason: "I know what I need", search_style: "generic_then_filter", style_reason: "Start broad", items: [{ list_item: "Foundation", first_move: 'type "foundation"', evidence_needed: "shade range", options_to_compare: 3 }] };
    const client = {
      create: async (p: any) =>
        p.tools.some((t: any) => t.name === "make_plan")
          ? (planCalls.push(p), { id: "p0", output: [{ type: "function_call", call_id: "p1", name: "make_plan", arguments: JSON.stringify(plan) }] })
          : (calls.push(p), script[calls.length - 1]),
    };
    try {
      const r = await runBrowserAgent(persona, cfg, () => {}, new AbortController().signal, { client, headless: true, startUrl: srv.url + "/", allowedHost: "127.0.0.1" });
      // Plans first, as the persona, in its own request; the plan then goes into the browsing instructions.
      expect(planCalls).toHaveLength(1);
      expect(planCalls[0].tool_choice).toBe("required");
      expect(planCalls[0].instructions).toContain("judged on how faithfully");
      expect(r.plan).toMatchObject({ entry: "search_box", search_style: "generic_then_filter" });
      expect(calls[0].instructions).toContain("Your plan");
      expect(calls[0].instructions).not.toContain("Quicklook");
      // Starts on the home page: computer tool plus the one input image, in the first request only.
      expect(calls[0].tools[0]).toEqual({ type: "computer" });
      expect(calls[0].tools.map((t: any) => t.name)).not.toContain("search");
      expect(calls[0].input[0].content[1].type).toBe("input_image");
      for (const c of calls.slice(1)) expect(JSON.stringify(c.input)).not.toContain("input_image");
      expect(calls[1].previous_response_id).toBe("r1");
      expect(calls[1].input[0]).toMatchObject({ type: "computer_call_output", call_id: "c1", output: { type: "computer_screenshot" } });
      expect(calls[3].input.filter((i: any) => i.call_id).map((i: any) => i.call_id)).toEqual(["f1", "f2", "f3", "f4"]);
      expect(JSON.parse(calls[3].input[3].output).ok).toBe(false); // over budget
      expect((r as any).settings).toMatchObject({ prompt_version: "browse-v10", fresh_browser: true, limit: { by: "steps" } });
      expect(r.items.map((i) => i.name)).toEqual(["Glow Tint"]);
      expect(r.items[0].productId).toContain("/product/glow-tint");
      // Sephora-style store: the product tile opened in a new tab, and the purchase came from it.
      expect(r.items[0].evidence).toBe("new tab");
      expect(r.activity!.some((a) => a.kind === "new_tab")).toBe(true);
      expect(r.summary).toBe("One hero foundation.");
      expect(r.stats).toMatchObject({ searches: 1, productsInspected: 1, clicks: 2, scrolls: 1, comparisons: 1, rejections: 1 });
      const kinds = r.activity!.map((a) => a.kind);
      expect(kinds).toEqual(expect.arrayContaining(["search", "product_view", "click", "scroll", "compare", "reject", "add", "finish"]));
      expect(r.activity!.find((a) => a.kind === "reject")!.reason).toBe("Packaging feels cheap");
    } finally {
      srv.close();
    }
  }, 60000);
});

describe("no buying without looking", () => {
  it("refuses add_to_basket on a new-tab store until the product was opened", async () => {
    const srv = await server();
    const calls: any[] = [];
    const add = { brand: "Lux", product_name: "Glow Tint", price_usd: 38, category: "complexion", tier: "prestige", reason: "Looks nice", main_influence: "reviews" };
    const script: any[] = [
      { id: "r1", output: [{ type: "computer_call", call_id: "c1", actions: [{ type: "click", button: "left", x: 50, y: 50 }], pending_safety_checks: [] }] },
      { id: "r2", output: [{ type: "function_call", call_id: "f1", name: "add_to_basket", arguments: JSON.stringify(add) }] },
      { id: "r3", output: [{ type: "function_call", call_id: "f2", name: "finish_shopping", arguments: JSON.stringify({ summary: "Nothing." }) }] },
    ];
    const client = { create: async (p: any) => (p.tools.some((t: any) => t.name === "make_plan") ? { id: "p0", output: [] } : (calls.push(p), script[calls.length - 1])) };
    try {
      const r = await runBrowserAgent(persona, cfg, () => {}, new AbortController().signal, { client, headless: true, startUrl: srv.url + "/", allowedHost: "127.0.0.1" });
      const out = JSON.parse(calls[2].input.find((i: any) => i.call_id === "f1").output);
      expect(out.ok).toBe(false);
      expect(out.error).toMatch(/Open it first/);
      expect(r.items).toHaveLength(0);
    } finally {
      srv.close();
    }
  }, 60000);
});

import { reviewSafetyChecks } from "../server/browser/shopAgent.js";
describe("safety check review", () => {
  const ok = (url: string, actions: any[]) => reviewSafetyChecks(url, "sephora.com", actions).ok;
  it("approves ordinary browsing on the retailer", () => {
    expect(ok("https://www.sephora.com/", [{ type: "click", x: 1, y: 1 }, { type: "type", text: "affordable blush" }, { type: "keypress", keys: ["ENTER"] }])).toBe(true);
  });
  it("refuses other sites, checkout pages, personal data and shortcuts", () => {
    expect(ok("https://evil.example.com/", [{ type: "click", x: 1, y: 1 }])).toBe(false);
    expect(ok("https://www.sephora.com/checkout", [{ type: "click", x: 1, y: 1 }])).toBe(false);
    expect(ok("https://www.sephora.com/", [{ type: "type", text: "me@example.com" }])).toBe(false);
    expect(ok("https://www.sephora.com/", [{ type: "type", text: "4111 1111 1111 1111" }])).toBe(false);
    expect(ok("https://www.sephora.com/", [{ type: "keypress", keys: ["CMD", "A"] }])).toBe(true);
    expect(ok("https://www.sephora.com/", [{ type: "keypress", keys: ["CMD", "L"] }])).toBe(false);
  });
});

import { scrollPixels } from "../server/browser/shopAgent.js";
describe("scroll amounts", () => {
  it("treats small values as wheel notches and large ones as pixels", () => {
    expect(scrollPixels(0, 4)).toEqual({ dx: 0, dy: 400 });
    expect(scrollPixels(0, -3)).toEqual({ dx: 0, dy: -300 });
    expect(scrollPixels(0, 600)).toEqual({ dx: 0, dy: 600 });
  });
});
