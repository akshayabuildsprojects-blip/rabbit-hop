import type { ActivityEntry, AgentEvent, AgentResult, AgentStats, BasketItem, Category, ExperimentConfig, Influence, PersonaConfig, ShopPlan, Tier } from "../../shared/types.js";
import { describeContext, describeMission } from "../personas/context.js";
import { MODEL_ID } from "../llm.js";
import fs from "node:fs";
import path from "node:path";
import { launchBrowser } from "./check.js";

// Autonomous shopping on the live retailer site with Meta Muse Spark computer use.
// Muse Spark sees screenshots and returns actions; this harness executes them in a real
// Chrome window and logs every action. Basket decisions, comparisons and rejections are
// recorded through function tools so each one carries a reason. The agent never signs in,
// never checks out and never enters personal details.

type Emit = (e: AgentEvent) => void;
export interface ResponsesClient {
  create(params: Record<string, unknown>, signal?: AbortSignal): Promise<any>;
}

// Per-store settings: where to start, and how its URLs look (for tracking and the link fallback).
export interface RetailerSite {
  id: string;
  name: string;
  start: string;
  searchUrl: string;
  searchParam: string;
  productPath: string; // path segment that marks a product page
  // How products open. "new_tab": a click on a product tile opens it in a new tab with a full page
  // load (Sephora refuses in-page product navigation for automated sessions). "click": normal.
  productOpen: "new_tab" | "click";
}
export const RETAILER_SITES: Record<string, RetailerSite> = {
  sephora: { id: "sephora", name: "Sephora (sephora.com, US)", start: "https://www.sephora.com/", searchUrl: "https://www.sephora.com/search", searchParam: "keyword", productPath: "/product/", productOpen: "new_tab" },
  oliveyoung: { id: "oliveyoung", name: "Olive Young US (us.oliveyoung.com)", start: "https://us.oliveyoung.com/", searchUrl: "https://us.oliveyoung.com/search", searchParam: "q", productPath: "/products/", productOpen: "click" },
};
export const RETAILER_IDS = Object.keys(RETAILER_SITES);

const VIEWPORT = { width: 1280, height: 800 };
const FORBIDDEN = /(checkout|\/basket|\/cart|sign-?in|login|\/profile|myaccount|\/account|beautyinsider\/join)/i;
const CATEGORIES: Category[] = ["cleanser", "serum", "moisturizer", "sunscreen", "lip", "complexion", "cheek", "eyes", "body"];
const TIERS: Tier[] = ["value", "mid", "prestige", "luxury"];
const INFLUENCES: Influence[] = ["trend", "reviews", "ingredients", "price", "brand_prestige", "dupe"];

export const FUNCTION_TOOLS = [
  {
    type: "function",
    name: "add_to_basket",
    description:
      "Record a product you have decided to buy, after opening its product page. Only if the store refused product pages and you have scrolled and read the results may you decide from a results tile. This is your basket; do not use the site's own Add to Basket or checkout.",
    parameters: {
      type: "object",
      properties: {
        brand: { type: "string" },
        product_name: { type: "string" },
        price_usd: { type: "number" },
        size: { type: "string" },
        category: { type: "string", enum: CATEGORIES },
        tier: { type: "string", enum: TIERS, description: "Your judgment of the price tier" },
        reason: { type: "string", description: "One sentence in your own voice on why you chose it" },
        main_influence: { type: "string", enum: INFLUENCES, description: "The single biggest factor in this decision" },
        list_item: { type: "string", description: "Which item on your shopping list this fills, e.g. Foundation" },
        evidence: { type: "string", enum: ["product page", "new tab", "quicklook", "results tile"], description: "Where the information you decided on came from" },
      },
      required: ["brand", "product_name", "price_usd", "category", "tier", "reason", "main_influence"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "remove_from_basket",
    description: "Remove a product you previously added.",
    parameters: {
      type: "object",
      properties: { product_name: { type: "string" }, reason: { type: "string" } },
      required: ["product_name", "reason"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "compare_products",
    description: "Record a comparison you made between 2 to 4 products, which one won and why.",
    parameters: {
      type: "object",
      properties: {
        products: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
        winner: { type: "string" },
        deciding_factor: { type: "string", description: "What decided it, in your own words" },
      },
      required: ["products", "winner", "deciding_factor"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "reject_product",
    description: "Record a product you looked at and decided not to buy, with the reason.",
    parameters: {
      type: "object",
      properties: { product_name: { type: "string" }, reason: { type: "string" } },
      required: ["product_name", "reason"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "read_page",
    description: "Read the text that is currently visible on screen (names, prices, ratings, badges, review snippets). It reads only what is in view; scroll to see more.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "open_in_new_tab",
    description: "Open a product you can see on screen in a new tab (like Cmd+click), using its link from read_page. Only product links currently on screen are allowed.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false },
  },
  {
    type: "function",
    name: "close_tab",
    description: "Close the current tab and go back to the previous one (for example the search results).",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "finish_shopping",
    description: "Call once when your basket is final.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Two sentences in your own voice describing your basket and strategy" },
        skipped_items: {
          type: "array",
          description: "Shopping-list items you did not buy, each with the reason",
          items: { type: "object", properties: { item: { type: "string" }, reason: { type: "string" } }, required: ["item", "reason"], additionalProperties: false },
        },
      },
      required: ["summary"],
      additionalProperties: false,
    },
  },
];

export const PLAN_TOOL = {
  type: "function",
  name: "make_plan",
  description: "Decide, as this persona, how you will shop this store before you start.",
  parameters: {
    type: "object",
    properties: {
      entry: { type: "string", enum: ["search_box", "category_menu", "bestsellers", "new_arrivals", "sale"], description: "Where you start" },
      entry_reason: { type: "string", description: "Why this persona starts there, in your own voice" },
      search_style: {
        type: "string",
        enum: ["generic_then_filter", "attribute_led", "brand_or_product_known", "mixed"],
        description: "generic_then_filter: plain product type, then narrow with filters, sort and what the site shows. attribute_led: the qualities you need (e.g. fragrance-free foundation). brand_or_product_known: you already know the brand or product. mixed: different per item.",
      },
      style_reason: { type: "string", description: "Why this persona searches this way" },
      items: {
        type: "array",
        description: "One entry per shopping-list item, in the order you will shop them",
        items: {
          type: "object",
          properties: {
            list_item: { type: "string" },
            first_move: { type: "string", description: "Exactly what you will type or click first for this item" },
            evidence_needed: { type: "string", description: "What you need to see before buying (e.g. shade range, reviews, ingredients, price)" },
            options_to_compare: { type: "integer", minimum: 1, maximum: 6, description: "How many options you will look at before deciding" },
          },
          required: ["list_item", "first_move", "evidence_needed", "options_to_compare"],
          additionalProperties: false,
        },
      },
    },
    required: ["entry", "entry_reason", "search_style", "style_reason", "items"],
    additionalProperties: false,
  },
};

const ENTRY_LABEL: Record<ShopPlan["entry"], string> = { search_box: "the search box", category_menu: "the category menus", bestsellers: "Best Sellers", new_arrivals: "New arrivals", sale: "Sale" };

export function describePlan(plan: ShopPlan): string {
  return `Start from ${ENTRY_LABEL[plan.entry] ?? plan.entry} (${plan.entry_reason}). Search style: ${plan.search_style.replace(/_/g, " ")} (${plan.style_reason}).
${plan.items.map((i) => `- ${i.list_item}: first ${i.first_move}; need to see ${i.evidence_needed}; compare ${i.options_to_compare} option${i.options_to_compare === 1 ? "" : "s"}.`).join("\n")}`;
}

export const PROMPT_VERSION = "browse-v9";

const MISSION_FRAME = `Your task is to behave exactly as this persona would. Your steps and your final basket will be judged on how faithfully they match this persona. Not on speed, not on finding the objectively best product, and not on spending the whole budget.`;

export function planInstructions(persona: PersonaConfig, cfg: ExperimentConfig, site: RetailerSite) {
  return `${MISSION_FRAME}

You are "${persona.name}".${persona.tagline ? ` ${persona.tagline}` : ""}
${persona.style}

Your mission:
${describeMission(cfg.mission)}

You are about to shop ${site.name}. Before you touch the page, decide how this persona would shop it and call make_plan.
- Where would this persona start: the search box, the category menus, Best Sellers, New arrivals or Sale?
- How would this persona search? Most real shoppers start generic (a plain product type such as "foundation", or a category) and narrow down with filters, sorting and what the store shows them. Start from a brand or a specific product only if this persona would genuinely already know it and walk in for it. Do not add brand names or words like "viral" to searches unless that is truly how this persona searches.
- For each list item: what you need to see before buying, and how many options you would look at.`;
}

export function browserInstructions(persona: PersonaConfig, cfg: ExperimentConfig, site: RetailerSite, plan?: ShopPlan) {
  const ctx = describeContext(cfg.context);
  const openRule =
    site.productOpen === "new_tab"
      ? `- Open every product you consider by clicking its tile: on this store it opens in a new tab. Read it there (read_page, scroll), then close_tab to return to the results. If a click does not open it, use open_in_new_tab with its link from read_page. Do not buy anything you have not opened.
- If the store refuses product pages, close the tab, scroll through the results and read them with read_page, then decide from the results tiles (brand, name, price, rating, review count, badges). That is the last resort, not the first.`
      : `- Open products by clicking their tiles and read them before buying. If clicking a tile does not open the product, use open_in_new_tab with its link from read_page, then close_tab to return.`;
  return `${MISSION_FRAME}

1. You are "${persona.name}".${persona.tagline ? ` ${persona.tagline}` : ""}
${persona.style}

2-4. Your mission:
${describeMission(cfg.mission)}
${ctx.startsWith("- No specific") ? "" : `\nWho you are shopping as:\n${ctx}\n`}${plan ? `\nYour plan (you made it as this persona; follow it, and if you deviate, say why in a sentence):\n${describePlan(plan)}\n` : ""}
5. Go. You are on the ${site.name} home page in a real browser.

Shop the way this persona really would on this site:
- You may bring what this persona already knows (brands, products, what is trending), but every move goes through the page: the site's search box, menus, banners, sorting, filters and product tiles. Type short searches the way this persona would.
- Notice what the site shows you (banners, Bestseller and New badges, sort order, ratings, review counts, prices, sale tags) and react to it as this persona.
- Read what is on screen with read_page; scroll to see more. Never type or open web addresses.
${openRule}
- Never stop or say you are stuck. Whatever opens or does not, keep making moves and decide from the information the store gives you.
- If a page or product will not open, do not retry it: choose a different product or move on.
- Pop-ups and sign-in prompts are closed for you. Never sign in, use the site's basket or checkout, or enter personal details.
- Record every decision with a reason: compare_products, reject_product, add_to_basket (naming the list item it fills and where your information came from), remove_from_basket.
- Stay within the budget. Write one short first-person sentence before each set of actions.
- When your list is handled, call finish_shopping, naming any list items you skipped and why.`;
}

// Stores that open products in a new tab: a click on a product link opens it in a new tab
// (a full page load) instead of navigating inside the results page.
export const NEW_TAB_SCRIPT = (productPath: string) => `(() => {
  if (window.__pclNewTab) return; window.__pclNewTab = true;
  document.addEventListener("click", (e) => {
    if (e.button !== 0) return;
    const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    let u; try { u = new URL(a.href, location.href); } catch { return; }
    if (u.host !== location.host || !u.pathname.includes(${JSON.stringify(productPath)})) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    window.open(u.href, "_blank");
  }, true);
})();`;

const KEY_MAP: Record<string, string> = {
  ENTER: "Enter", RETURN: "Enter", ESC: "Escape", ESCAPE: "Escape", TAB: "Tab", SPACE: " ", BACKSPACE: "Backspace", DELETE: "Delete",
  UP: "ArrowUp", DOWN: "ArrowDown", LEFT: "ArrowLeft", RIGHT: "ArrowRight", ARROWUP: "ArrowUp", ARROWDOWN: "ArrowDown", ARROWLEFT: "ArrowLeft", ARROWRIGHT: "ArrowRight",
  CTRL: "Control", CONTROL: "Control", CMD: "Meta", META: "Meta", COMMAND: "Meta", ALT: "Alt", OPTION: "Alt", SHIFT: "Shift", PAGEDOWN: "PageDown", PAGEUP: "PageUp", HOME: "Home", END: "End",
};
export const mapKey = (k: string) => KEY_MAP[k.toUpperCase()] ?? (k.length === 1 ? k : k[0].toUpperCase() + k.slice(1).toLowerCase());

const NAMED_KEYS = new Set(["ENTER", "RETURN", "ESC", "ESCAPE", "TAB", "SPACE", "BACKSPACE", "DELETE", "UP", "DOWN", "LEFT", "RIGHT", "ARROWUP", "ARROWDOWN", "ARROWLEFT", "ARROWRIGHT", "CTRL", "CONTROL", "CMD", "META", "COMMAND", "ALT", "OPTION", "SHIFT", "PAGEDOWN", "PAGEUP", "HOME", "END"]);
export function isTypedWord(keys: string[]): boolean {
  if (!keys.length) return false;
  if (keys.some((k) => NAMED_KEYS.has(k.toUpperCase()) || /^F\d{1,2}$/i.test(k))) return keys.length === 1 ? false : keys.every((k) => k.length === 1) && !keys.some((k) => NAMED_KEYS.has(k.toUpperCase()));
  return keys.length > 1 ? keys.every((k) => k.length === 1) : keys[0].length > 1;
}

export function describeAction(a: any): string {
  switch (a.type) {
    case "click": return `click ${a.button && a.button !== "left" ? a.button + " " : ""}at (${a.x}, ${a.y})`;
    case "double_click": return `double-click at (${a.x}, ${a.y})`;
    case "type": return `type "${String(a.text).slice(0, 80)}"`;
    case "keypress": return isTypedWord((a.keys ?? []).map(String)) ? `type "${(a.keys ?? []).join("")}"` : `press ${(a.keys ?? []).join("+")}`;
    case "scroll": return `scroll ${a.scroll_y > 0 ? "down" : a.scroll_y < 0 ? "up" : a.scroll_x > 0 ? "right" : "left"}`;
    case "drag": return "drag";
    case "move": return `move to (${a.x}, ${a.y})`;
    case "wait": return "wait";
    case "screenshot": return "look at the page";
    default: return a.type;
  }
}

async function execute(page: any, a: any) {
  switch (a.type) {
    case "click":
      if (a.button === "back") return page.goBack({ timeout: 8000 }).catch(() => {});
      if (a.button === "forward") return page.goForward({ timeout: 8000 }).catch(() => {});
      return page.mouse.click(a.x, a.y, { button: a.button === "right" ? "right" : a.button === "wheel" ? "middle" : "left" });
    case "double_click":
      return page.mouse.dblclick(a.x, a.y);
    case "type":
      return page.keyboard.type(String(a.text ?? ""), { delay: 25 });
    case "keypress": {
      const raw: string[] = (a.keys ?? []).map(String);
      // The model sometimes "presses" a word (["F","o","u",...] or ["foundation"]): type it instead.
      if (isTypedWord(raw)) return page.keyboard.type(raw.join(""), { delay: 25 });
      const keys = raw.map(mapKey).map((k: string) => (k === "Control" || k === "Meta" ? "ControlOrMeta" : k));
      return keys.length ? page.keyboard.press(keys.join("+")) : undefined;
    }
    case "scroll": {
      await page.mouse.move(a.x ?? VIEWPORT.width / 2, a.y ?? VIEWPORT.height / 2);
      const { dx, dy } = scrollPixels(a.scroll_x ?? 0, a.scroll_y ?? 0);
      // Several small wheel steps so the scroll is visible on screen and in recordings.
      const steps = Math.max(1, Math.min(8, Math.round(Math.max(Math.abs(dx), Math.abs(dy)) / 100)));
      for (let i = 0; i < steps; i++) {
        await page.mouse.wheel(dx / steps, dy / steps);
        await page.waitForTimeout(60);
      }
      return;
    }
    case "move":
      return page.mouse.move(a.x, a.y);
    case "drag": {
      const path = a.path ?? [];
      if (path.length < 2) return;
      await page.mouse.move(path[0].x, path[0].y);
      await page.mouse.down();
      for (const p of path.slice(1)) await page.mouse.move(p.x, p.y, { steps: 5 });
      return page.mouse.up();
    }
    case "wait":
      return page.waitForTimeout(1500);
    default:
      return;
  }
}

// Text currently visible in the viewport, plus visible product links (for the open_link fallback).
async function readVisible(page: any, productPath = "/product/"): Promise<{ text: string; links: { text: string; href: string }[] }> {
  try {
    return await page.evaluate((productPath: string) => {
      const H = window.innerHeight, W = window.innerWidth;
      const inView = (r: DOMRect) => r.bottom > 0 && r.top < H && r.right > 0 && r.left < W && r.width > 0 && r.height > 0;
      const parts: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n: Node | null;
      while ((n = walker.nextNode()) && parts.join(" ").length < 5000) {
        const t = (n.textContent || "").replace(/\s+/g, " ").trim();
        if (!t) continue;
        const el = n.parentElement;
        if (!el) continue;
        const st = getComputedStyle(el);
        if (st.visibility === "hidden" || st.display === "none") continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        if (inView(range.getBoundingClientRect())) parts.push(t);
      }
      const links = Array.from(document.querySelectorAll(`a[href*='${productPath}']`))
        .filter((a) => inView((a as HTMLElement).getBoundingClientRect()))
        .slice(0, 20)
        .map((a) => ({ text: ((a as HTMLElement).innerText || "").replace(/\s+/g, " ").trim().slice(0, 100), href: (a as HTMLAnchorElement).href }))
        .filter((l) => l.text);
      return { text: parts.join(" | ").slice(0, 5000), links };
    }, productPath);
  } catch {
    return { text: "", links: [] };
  }
}

export interface RunSettings {
  prompt_version: string;
  model: string;
  limit: { by: "steps" | "minutes"; steps: number; minutes: number };
  viewport: { width: number; height: number };
  locale: string;
  timezone: string;
  start_url: string;
  fresh_browser: true;
  temperature_applied: boolean;
  reasoning_effort_applied: boolean;
}

export const PAGE_SHIM = "globalThis.__name = globalThis.__name || function (f) { return f; };";

// Runs inside every page: whenever a sign-in or account pop-up appears (it contains a password
// field), hides its outermost fixed-position container, which includes the dark backdrop.
// This is what a shopper does by closing it, without spending the model's steps on it.
export const SUPPRESS_SIGNIN_SCRIPT = `(() => {
  let t = 0;
  const vis = (el) => { const st = getComputedStyle(el); const r = el.getBoundingClientRect(); return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const fixedRoot = (el) => { let outer = null; while (el && el !== document.body) { if (getComputedStyle(el).position === 'fixed') outer = el; el = el.parentElement; } return outer; };
  const hide = () => {
    let found = false;
    for (const pw of document.querySelectorAll('input[type=password]')) {
      if (!vis(pw)) continue;
      const root = fixedRoot(pw) || pw.closest('[role=dialog],[aria-modal=true]');
      if (!root) continue;
      found = true;
      // Prefer the site's own close button, so the site removes its backdrop itself.
      const close = Array.from(root.querySelectorAll('button,[role=button]')).find((b) => /close|dismiss/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' + (b.getAttribute('data-at') || '')) || (b.textContent || '').trim() === '×');
      if (close) close.click(); else root.style.setProperty('display', 'none', 'important');
    }
    // Any leftover full-screen dimming layer (backdrop) with no content of its own.
    for (const el of document.querySelectorAll('body > *, body > * > *')) {
      if (getComputedStyle(el).position !== 'fixed' || !vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9 && (el.textContent || '').trim().length < 3) el.style.setProperty('display', 'none', 'important');
    }
    // Make the page interactive again.
    for (const el of document.querySelectorAll('[inert]')) el.removeAttribute('inert');
    if (found) for (const el of document.querySelectorAll('body > [aria-hidden=true]')) el.removeAttribute('aria-hidden');
    if (document.body) document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  };
  const start = () => {
    hide();
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(hide, 60); }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'inert'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();`;

// Closes pop-ups, sign-in prompts and cookie banners so the model never spends turns on them.
// Prefers declining non-essential cookies when a banner offers it.
export async function dismissOverlays(page: any): Promise<number> {
  try {
    return await page.evaluate(() => {
      let n = 0;
      const visible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const st = getComputedStyle(el as HTMLElement);
        return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
      };
      const clickIt = (el: Element | null) => {
        if (el && visible(el)) {
          (el as HTMLElement).click();
          n++;
          return true;
        }
        return false;
      };
      // Cookie banners: decline non-essential first.
      for (const b of Array.from(document.querySelectorAll("button, a"))) {
        const t = ((b as HTMLElement).innerText || "").trim().toLowerCase();
        if (/^(reject all|decline|decline all|reject|only necessary|necessary only)$/.test(t)) clickIt(b);
      }
      // Sign-in, cookie and newsletter dialogs only: click their close button, else remove them.
      // Product pop-ups (for example Quicklook, which shows prices) are left open.
      const dialogs = Array.from(document.querySelectorAll("[role=dialog], [aria-modal=true], [data-at*=modal], .ReactModal__Overlay"));
      for (const d of dialogs) {
        if (!visible(d)) continue;
        const txt = (d as HTMLElement).innerText || "";
        const isChore = !!d.querySelector("input[type=password]") || /sign in|log in|create account|cookie|privacy choices|newsletter|subscribe|email address|join now/i.test(txt);
        if (!isChore || /\$\s?\d/.test(txt)) continue;
        const close = d.querySelector("button[aria-label*=close i], button[aria-label*=dismiss i], [data-at*=close], button[class*=close i]");
        if (!clickIt(close)) {
          (d as HTMLElement).remove();
          n++;
        }
      }
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
      return n;
    });
  } catch {
    return 0;
  }
}

// A store's "this request was refused" error (for example Sephora's "Something went wrong.
// Please try again later or from another device"). Two of these end the shopper's run cleanly.
export const SITE_ERROR = /something went wrong\.?\s*please try again later|try again later or from another device|access denied|request unsuccessful/i;
async function siteErrorShown(page: any): Promise<boolean> {
  try {
    const t: string = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll("[role=dialog],[aria-modal=true],[role=alert],h1,h2"));
      return els.map((e) => (e as HTMLElement).innerText || "").join(" ").slice(0, 3000) + " " + (document.title || "");
    });
    return SITE_ERROR.test(t);
  } catch {
    return false;
  }
}
// A fixed gap between actions in the same turn, and a settle wait after each turn.
const ACTION_GAP_MS = 400;
async function settle(page: any) {
  await page.waitForLoadState("domcontentloaded", { timeout: 6000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(600);
}

// Harness review of Meta safety checks. Approves only ordinary browsing on the allowed site:
// no sign-in/account/basket/checkout pages, and no typed text that could be personal or payment data.
const SAFE_KEYS = new Set(["F5", "Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageDown", "PageUp", "Home", "End", "Backspace", " "]);
export function reviewSafetyChecks(url: string, allowedHost: string, actions: any[]): { ok: boolean; reason?: string } {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {}
  if (!(host === allowedHost || host.endsWith("." + allowedHost))) return { ok: false, reason: `the browser is on ${host || url}, not ${allowedHost}` };
  if (FORBIDDEN.test(url)) return { ok: false, reason: "the page is a sign-in, account, basket or checkout page" };
  for (const a of actions) {
    if (["click", "double_click", "scroll", "move", "wait", "screenshot"].includes(a.type)) continue;
    if (a.type === "keypress" && isTypedWord((a.keys ?? []).map(String))) {
      const t = (a.keys ?? []).join("");
      if (t.length > 80 || /@|\d{5,}|password|https?:|www\./i.test(t)) return { ok: false, reason: "typed text looks like personal details or a web address" };
      continue;
    }
    if (a.type === "keypress") {
      const keys = (a.keys ?? []).map(mapKey);
      if (keys.length === 1 && SAFE_KEYS.has(keys[0])) continue;
      if (keys.length === 2 && ["Control", "Meta"].includes(keys[0]) && keys[1].toLowerCase() === "a") continue; // select all (to replace search text)
      return { ok: false, reason: `key combination ${keys.join("+")} is not on the allowed list` };
    }
    if (a.type === "type") {
      const t = String(a.text ?? "");
      if (t.length > 80) return { ok: false, reason: "typed text is longer than a search term" };
      if (/@|\d{5,}|\d[\d\s-]{8,}\d|password/i.test(t)) return { ok: false, reason: "typed text looks like personal, contact or payment details" };
      continue;
    }
    return { ok: false, reason: `action ${a.type} is not on the allowed list` };
  }
  return { ok: true };
}

// Muse Spark sends small scroll values as wheel notches (e.g. 3); larger values are pixels.
export const WHEEL_NOTCH_PX = 100;
export function scrollPixels(x: number, y: number) {
  const conv = (v: number) => (Math.abs(v) > 0 && Math.abs(v) < 50 ? v * WHEEL_NOTCH_PX : v);
  return { dx: conv(x), dy: conv(y) };
}

// Classifies a URL change into the activity it represents.
export function classifyUrl(url: string, productPath = "/product/"): { kind: "search" | "product_view" | "page_view"; detail: string } {
  try {
    const u = new URL(url);
    const kw = u.searchParams.get("keyword") ?? u.searchParams.get("q") ?? u.searchParams.get("query");
    if (/\/search/i.test(u.pathname) && kw) return { kind: "search", detail: kw };
    if (u.pathname.includes(productPath)) return { kind: "product_view", detail: u.pathname.split(productPath)[1]?.split("-P")[0]?.replace(/-/g, " ") || u.pathname };
    return { kind: "page_view", detail: u.pathname + (u.search ? u.search.slice(0, 80) : "") };
  } catch {
    return { kind: "page_view", detail: url };
  }
}

export function emptyStats(): Required<AgentStats> {
  return { steps: 0, searches: 0, productsInspected: 0, trendChecks: 0, alternativesChecked: 0, removals: 0, clicks: 0, typing: 0, scrolls: 0, pageViews: 0, comparisons: 0, rejections: 0 };
}

export async function runBrowserAgent(
  persona: PersonaConfig,
  cfg: ExperimentConfig,
  emit: Emit,
  signal: AbortSignal,
  opts: {
    client: ResponsesClient;
    retailer?: string;
    limitBy?: "steps" | "minutes";
    maxSteps?: number;
    maxMinutes?: number;
    headless?: boolean;
    startUrl?: string;
    allowedHost?: string;
    shotDir?: string;
  },
): Promise<AgentResult & { settings: RunSettings }> {
  const site = RETAILER_SITES[opts.retailer ?? "sephora"];
  const allowedHost = opts.allowedHost ?? new URL(site.start).hostname.replace(/^www\./, "");
  const limitBy = opts.limitBy ?? "steps";
  // The chosen limit is primary; the other is a safety cap.
  const maxSteps = limitBy === "steps" ? (opts.maxSteps ?? 30) : 120;
  const maxMinutes = limitBy === "minutes" ? (opts.maxMinutes ?? 5) : 20;
  const deadline = Date.now() + maxMinutes * 60_000;
  const stats = emptyStats();
  const activity: ActivityEntry[] = [];
  const items: BasketItem[] = [];
  let summary = "";
  let skipped: { item: string; reason: string }[] = [];
  let finished = false;
  const t0 = Date.now();
  const startUrl = opts.startUrl ?? site.start;
  const settings: RunSettings = {
    prompt_version: PROMPT_VERSION,
    model: MODEL_ID,
    limit: { by: limitBy, steps: maxSteps, minutes: maxMinutes },
    viewport: VIEWPORT,
    locale: "en-US",
    timezone: "America/New_York",
    start_url: startUrl,
    fresh_browser: true,
    temperature_applied: true,
    reasoning_effort_applied: true,
  };
  const log = (kind: ActivityEntry["kind"], detail: string, extra: Partial<ActivityEntry> = {}) => {
    activity.push({ t: Math.round((Date.now() - t0) / 1000), kind, detail, ...extra });
  };
  const tool = (name: string, summaryText: string, args: Record<string, unknown> = {}) => emit({ type: "tool", agent: persona.id, tool: name, args, summary: summaryText });
  // Thoughts go to the live view and into the saved activity log, so saved journeys keep them.
  const rawEmit = emit;
  emit = (e: AgentEvent) => {
    if (e.type === "thought") log("thought", e.text.slice(0, 400));
    rawEmit(e);
  };

  const { browser } = await launchBrowser(opts.headless ?? false);
  try {
    // A fresh, non-persistent context every run: no cookies, history or storage carried over.
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: settings.locale, timezoneId: settings.timezone });
    // The dev runner (tsx/esbuild) wraps named helper functions in __name(...), which does not exist
    // inside web pages; without this shim, in-page helpers such as read_page silently fail.
    await context.addInitScript(PAGE_SHIM);
    await context.addInitScript(SUPPRESS_SIGNIN_SCRIPT);
    if (site.productOpen === "new_tab") await context.addInitScript(NEW_TAB_SCRIPT(site.productPath));
    let page = await context.newPage();
    context.on("page", (p: any) => {
      if (p !== page) {
        tabStack.push(page);
        page = p;
      }
    });
    await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);
    let lastUrl = page.url();
    log("page_view", classifyUrl(lastUrl, site.productPath).detail, { url: lastUrl });
    stats.pageViews++;

    let shotCount = 0;
    if (opts.shotDir) fs.mkdirSync(opts.shotDir, { recursive: true });
    const shot = async () => {
      if (await dismissOverlays(page)) await page.waitForTimeout(300);
      const buf: Buffer = await page.screenshot({ type: "jpeg", quality: 55 });
      if (opts.shotDir) {
        shotCount++;
        try {
          fs.writeFileSync(path.join(opts.shotDir, `${String(shotCount).padStart(3, "0")}.jpg`), buf);
        } catch {}
      }
      return `data:image/jpeg;base64,${buf.toString("base64")}`;
    };
    const onAllowedSite = (u: string) => {
      try {
        const h = new URL(u).hostname.replace(/^www\./, "");
        return (h === allowedHost || h.endsWith("." + allowedHost)) && !FORBIDDEN.test(u);
      } catch {
        return false;
      }
    };
    // Records a navigation as a search, product view or page view (one journey line each).
    const track = (url: string) => {
      if (url === lastUrl) return;
      const c = classifyUrl(url, site.productPath);
      if (c.kind === "search") stats.searches++;
      else if (c.kind === "product_view") stats.productsInspected++;
      stats.pageViews++;
      log(c.kind, c.detail, { url });
      tool(c.kind === "search" ? "page_search" : c.kind === "product_view" ? "page_product" : "page_view", c.kind === "search" ? `Searched "${c.detail}"` : `Opened ${c.detail}`, { url });
      lastUrl = url;
      if (c.kind === "product_view" && /^[A-Z]{2}\d{5,}$/.test(c.detail)) {
        // Store uses opaque product ids in URLs: record the product's page title instead.
        page.title().then((t: string) => {
          const last = activity[activity.length - 1];
          if (t && last && last.url === url) last.detail = t.replace(/\s*\|.*$/, "").slice(0, 120);
        }).catch(() => {});
      }
    };
    const total = () => Math.round(items.reduce((s, i) => s + i.price, 0) * 100) / 100;
    // Product links the shopper has actually seen on screen (from read_page). open_link accepts only these.
    let seenLinks = new Set<string>();
    const seenTexts = new Map<string, string>(); // page -> what read_page showed
    const norm = (u: string) => {
      try {
        const x = new URL(u);
        return x.origin + x.pathname;
      } catch {
        return u;
      }
    };

    // Optional settings: lowest randomness and quick reasoning. Dropped if the API rejects them.
    let useTemperature = true;
    let useReasoning = true;
    const call = async (params: Record<string, unknown>) => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const req = { ...params, ...(useTemperature ? { temperature: 0 } : {}), ...(useReasoning ? { reasoning: { effort: "low" } } : {}) };
        try {
          return await opts.client.create(req, signal);
        } catch (e: any) {
          const m = String(e?.message ?? e);
          if (useTemperature && /temperature/i.test(m)) {
            useTemperature = false;
            settings.temperature_applied = false;
          } else if (useReasoning && /reasoning|effort/i.test(m)) {
            useReasoning = false;
            settings.reasoning_effort_applied = false;
          } else if ("tool_choice" in params && /tool_choice/i.test(m)) {
            const { tool_choice, ...rest } = params;
            params = rest;
          } else throw e;
        }
      }
      throw new Error("The model request kept failing.");
    };

    // Products the shopper opened and could read (page -> title). On new-tab stores, buying needs one of
    // these, unless the store refused product pages and the shopper then scrolled and read the results.
    const openedProducts = new Map<string, string>();
    let scrolledAfterRefusal = false;
    let readAfterRefusal = false;
    let deciding = false;
    const rememberProduct = async (p: any) => {
      const u = p.url();
      if (!u.includes(site.productPath)) return;
      const t = await p.title().catch(() => "");
      openedProducts.set(norm(u), String(t || "").replace(/\s*\|.*$/, ""));
    };

    // Planning step: before browsing, the shopper decides as the persona how it will shop this store.
    // Its own request (no browsing tools), so it is not counted as a browsing step.
    let plan: ShopPlan | undefined;
    try {
      const pres = await call({
        model: MODEL_ID,
        instructions: planInstructions(persona, cfg, site),
        tools: [PLAN_TOOL],
        tool_choice: "required",
        input: [{ role: "user", content: [{ type: "input_text", text: `This is the ${site.name} home page. Make your plan.` }, { type: "input_image", image_url: await shot() }] }],
      });
      const fc = (pres.output ?? []).find((x: any) => x.type === "function_call" && x.name === "make_plan");
      if (fc) {
        const a = JSON.parse(fc.arguments || "{}");
        plan = {
          entry: a.entry,
          entry_reason: String(a.entry_reason ?? ""),
          search_style: a.search_style,
          style_reason: String(a.style_reason ?? ""),
          items: (Array.isArray(a.items) ? a.items : []).map((i: any) => ({ list_item: String(i.list_item ?? ""), first_move: String(i.first_move ?? ""), evidence_needed: String(i.evidence_needed ?? ""), options_to_compare: Number(i.options_to_compare) || 1 })),
        };
        log("plan", describePlan(plan));
        tool("make_plan", `Plan: start from ${plan.entry.replace(/_/g, " ")}, ${plan.search_style.replace(/_/g, " ")} searches`, a);
        emit({ type: "thought", agent: persona.id, text: `My plan: ${describePlan(plan)}` });
      }
    } catch (e: any) {
      log("error", `Planning step failed: ${String(e?.message ?? e).split("\n")[0]}`);
    }

    // The only input image goes in the first request; later screenshots travel as computer_call_output.
    let input: any[] = [
      {
        role: "user",
        content: [
          { type: "input_text", text: `This is the ${site.name} home page. Begin your mission${plan ? ", following your plan" : ""}.` },
          { type: "input_image", image_url: await shot() },
        ],
      },
    ];
    let previous: string | undefined;
    let nudges = 0;
    let warned = false;
    let limitHit = "";
    let siteErrors = 0;
    const tabStack: any[] = [];
    let resultsRefused = 0;
    let productPagesRefused = false;

    for (let turn = 0; !finished; turn++) {
      if (signal.aborted) throw new Error("Cancelled");
      if (turn >= maxSteps) {
        limitHit = `step limit (${maxSteps})`;
        break;
      }
      if (Date.now() > deadline) {
        limitHit = `time limit (${maxMinutes} min)`;
        break;
      }
      const nearEnd = limitBy === "steps" ? turn >= maxSteps - 3 : Date.now() > deadline - 60_000;
      if (!warned && nearEnd) {
        warned = true;
        input = [...input, { role: "user", content: [{ type: "input_text", text: "You are almost out of steps/time. Decide now: record your remaining decisions and call finish_shopping." }] }];
      }
      stats.steps++;
      const res = await call({
        model: MODEL_ID,
        instructions: browserInstructions(persona, cfg, site, plan),
        tools: [{ type: "computer" }, ...FUNCTION_TOOLS],
        input,
        ...(previous ? { previous_response_id: previous } : {}),
      });
      previous = res.id;
      const output: any[] = res.output ?? [];
      const next: any[] = [];
      let computerCall: any = null;

      for (const item of output) {
        if (item.type === "message") {
          const text = (item.content ?? []).map((c: any) => c.text ?? "").join(" ").trim();
          if (text) emit({ type: "thought", agent: persona.id, text });
        } else if (item.type === "reasoning") {
          const text = (item.summary ?? []).map((s: any) => s.text ?? "").join(" ").trim();
          if (text) emit({ type: "thought", agent: persona.id, text });
        } else if (item.type === "function_call") {
          let args: any = {};
          try {
            args = JSON.parse(item.arguments || "{}");
          } catch {}
          const out = await handleFunction(item.name, args);
          next.push({ type: "function_call_output", call_id: item.call_id, output: JSON.stringify(out) });
        } else if (item.type === "computer_call") {
          computerCall = item;
        }
      }

      if (computerCall) {
        const checks: any[] = computerCall.pending_safety_checks ?? [];
        let acknowledged: any[] = [];
        const actions = computerCall.actions ?? (computerCall.action ? [computerCall.action] : []);
        if (checks.length) {
          const verdict = reviewSafetyChecks(page.url(), allowedHost, actions);
          const msg = checks.map((c: any) => [c.code, c.message].filter(Boolean).join(": ")).join("; ");
          if (!verdict.ok) {
            log("safety_stop", `${msg} | not approved: ${verdict.reason}`);
            emit({ type: "thought", agent: persona.id, text: `Stopped at a safety check (${msg}). Not approved because ${verdict.reason}.` });
            limitHit = "safety check";
            break;
          }
          acknowledged = checks.map((c: any) => ({ id: c.id, code: c.code, message: c.message }));
          log("safety_ack", `${msg} | approved for: ${actions.map(describeAction).join(", ")}`);
        }
        const pageBefore = page;
        for (const a of actions) {
          if (signal.aborted) throw new Error("Cancelled");
          const d = describeAction(a);
          if (a.type === "click" || a.type === "double_click") stats.clicks++;
          if (a.type === "type") stats.typing++;
          if (a.type === "scroll") {
            stats.scrolls++;
            if (productPagesRefused && !page.url().includes(site.productPath)) scrolledAfterRefusal = true;
          }
          if (!["screenshot", "move", "wait"].includes(a.type)) {
            log(a.type === "double_click" ? "click" : a.type, d);
            tool(`browser_${a.type}`, d, a);
          }
          if (a.type === "type" && /https?:|www\.|\.com\b|\/search\?|keyword=/i.test(String(a.text ?? ""))) {
            log("blocked_page", `typed URL refused: ${String(a.text).slice(0, 80)}`);
            continue;
          }
          try {
            await execute(page, a);
          } catch (e: any) {
            log("error", `${d} failed: ${String(e.message).split("\n")[0]}`);
          }
          if (!["screenshot", "wait", "move"].includes(a.type)) await page.waitForTimeout(ACTION_GAP_MS);
        }
        let note = "";
        if (page !== pageBefore) {
          // A product tile opened in a new tab: wait for it to load, then work in it.
          for (let i = 0; i < 20 && /^about:blank/.test(page.url()); i++) await page.waitForTimeout(250);
          await settle(page);
          await page.bringToFront().catch(() => {});
          log("new_tab", page.url(), { url: page.url() });
          tool("open_in_new_tab", "Opened a product in a new tab", { url: page.url() });
          note = "That product opened in a new tab. Read it (read_page, scroll), then close_tab to return to the results.";
        } else await settle(page);
        const url = page.url();
        const failedUrl = lastUrl !== url ? url : lastUrl;
        if (FORBIDDEN.test(url)) {
          await page.goBack({ timeout: 8000 }).catch(() => page.goto(site.start).catch(() => {}));
          note = "That page (sign-in, account, basket or checkout) is not allowed. You were taken back. Record purchases with add_to_basket instead.";
          log("blocked_page", url);
        } else track(url);
        const refusedNow = await siteErrorShown(page);
        if (!refusedNow) await rememberProduct(page);
        if (refusedNow) {
          siteErrors++;
          const where = classifyUrl(failedUrl, site.productPath);
          const store = site.name.split(" (")[0];
          if (where.kind === "product_view") {
            productPagesRefused = true;
            scrolledAfterRefusal = readAfterRefusal = false;
            log("site_blocked", `${store} refused a product page: ${where.detail}`, { url: failedUrl });
            note = tabStack.length
              ? "The store refused that product page. Do not retry it. Call close_tab to return to the results, try opening a different product, and if the store keeps refusing, scroll through the results and read them with read_page, then decide from the tiles."
              : "The store refused that product page. Do not retry it. Try a different product, and if the store keeps refusing, scroll through the results and read them with read_page, then decide from the tiles.";
          } else {
            resultsRefused++;
            log("site_blocked", `${store} refused a page (${resultsRefused} of 2): ${where.detail}`, { url: failedUrl });
            note = productPagesRefused
              ? "The store refused that too. Do not retry it. Scroll and read the results you can reach and decide from the tiles, or try a different search."
              : "The store refused that page. Do not retry it; try a different product or search.";
            if (resultsRefused >= 3) {
              limitHit = "site block";
              emit({ type: "thought", agent: persona.id, text: `${store} keeps refusing pages for this automated session. Moving to a final decision with what has been seen.` });
            }
          }
        }
        next.push({ type: "computer_call_output", call_id: computerCall.call_id, acknowledged_safety_checks: acknowledged, output: { type: "computer_screenshot", image_url: await shot() } });
        if (note) next.push({ role: "user", content: [{ type: "input_text", text: note }] });
      }

      if (finished || limitHit === "site block") break;
      if (!computerCall && !next.length) {
        if (++nudges > 2) break;
        next.push({ role: "user", content: [{ type: "input_text", text: "Continue the mission on the page. Take a screenshot to see it, record your decisions, and call finish_shopping when your list is handled." }] });
      }
      input = next;
    }

    // Final decide step: whenever browsing ends without finish_shopping (limit, store refusals, safety
    // check), the shopper must still decide from what it saw. No browsing tools; it may buy, reject,
    // compare and finish. "Pages did not load" alone is not accepted as a reason to buy nothing.
    if (!finished && !signal.aborted) {
      const why = limitHit === "site block" ? "the store kept refusing pages" : limitHit ? `you reached the ${limitHit}` : "browsing ended";
      emit({ type: "thought", agent: persona.id, text: `Browsing ended (${why}). Deciding from what was seen on the store.` });
      log("decide_step", why);
      deciding = true;
      const recap = activity
        .filter((x) => ["search", "product_view", "compare", "reject", "add", "remove"].includes(x.kind))
        .map((x) => `- ${x.kind}: ${x.detail}${x.reason ? ` (${x.reason})` : ""}`)
        .join("\n");
      const seen = [...seenTexts.values()].join("\n---\n").slice(0, 7000);
      const decideTools = FUNCTION_TOOLS.filter((t) => ["add_to_basket", "reject_product", "compare_products", "finish_shopping"].includes(t.name));
      try {
        let req: Record<string, unknown> = {
          model: MODEL_ID,
          instructions: browserInstructions(persona, cfg, site, plan),
          tools: decideTools,
          tool_choice: "required",
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `Browsing has ended because ${why}. You must now decide, as this persona, from what the store showed you. Do not say you are stuck.

What you did:
${recap || "- nothing recorded"}

What you saw on the store (text from the pages you read):
${seen || "(no page text was read)"}

Your basket: ${items.map((i) => `${i.brand} ${i.name} ($${i.price})`).join(", ") || "empty"}. Budget: $${cfg.budget}, $${Math.round((cfg.budget - total()) * 100) / 100} left.

Work through your shopping list in priority order. For each item, either add_to_basket an option you saw (evidence "results tile" unless you opened its page) or reject_product the options you saw, with the reason. Buy the must-have item if any option you saw fits the budget and your standards; "pages did not load" alone is not a reason to buy nothing. Then call finish_shopping with your summary and any list items you skipped, with reasons.`,
                },
              ],
            },
          ],
        };
        for (let round = 0; round < 3 && !finished; round++) {
          const res = await call(req);
          const outs: any[] = [];
          for (const item of res.output ?? []) {
            if (item.type !== "function_call") continue;
            let args: any = {};
            try {
              args = JSON.parse(item.arguments || "{}");
            } catch {}
            const out = await handleFunction(item.name, args);
            outs.push({ type: "function_call_output", call_id: item.call_id, output: JSON.stringify(out) });
          }
          if (finished || !outs.length) break;
          req = { model: MODEL_ID, instructions: browserInstructions(persona, cfg, site, plan), tools: decideTools, input: outs, previous_response_id: res.id };
        }
      } catch (e: any) {
        log("error", `Decide step failed: ${String(e?.message ?? e).split("\n")[0]}`);
      }
    }

    return { personaId: persona.id, items, total: total(), summary, stats, activity, skipped, settings, ...(plan ? { plan } : {}), ...(limitHit === "site block" ? { blocked: true } : {}) };

    // On new-tab stores: no buying without looking. Allowed when the product was opened (or is open now),
    // or, as the last resort, when the store refused product pages and the shopper scrolled and read the
    // results. The final decide step is exempt.
    function lookedAt(args: any, url: string): { ok: boolean; error?: string; evidence?: BasketItem["evidence"] } {
      if (site.productOpen !== "new_tab" || deciding) return { ok: true };
      if (url.includes(site.productPath) && openedProducts.has(norm(url))) return { ok: true, evidence: tabStack.length ? "new tab" : "product page" };
      const words = (x: string) => String(x ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
      const brand = String(args.brand ?? "").toLowerCase();
      const nameWords = words(args.product_name).filter((w) => !brand.includes(w));
      for (const title of openedProducts.values()) {
        const t = title.toLowerCase();
        if ((!brand || t.includes(brand)) && nameWords.filter((w) => t.includes(w)).length >= Math.min(2, nameWords.length || 1)) return { ok: true, evidence: "new tab" };
      }
      if (productPagesRefused) {
        if (scrolledAfterRefusal && readAfterRefusal) return { ok: true, evidence: "results tile" };
        return { ok: false, error: "The store refused product pages, so scroll through the results and read them with read_page first, then decide from the tiles." };
      }
      return { ok: false, error: "Open it first: click its tile (it opens in a new tab), read it, then decide." };
    }

    async function handleFunction(name: string, args: any): Promise<Record<string, unknown>> {
      let out: Record<string, unknown> = { ok: true };
      const url = page.url();
      if (name === "add_to_basket") {
        const price = Number(args.price_usd) || 0;
        const looked = lookedAt(args, url);
        if (!looked.ok) {
          out = { ok: false, error: looked.error };
        } else if (total() + price > cfg.budget + 0.001) {
          out = { ok: false, error: `Over budget: basket is $${total()} of $${cfg.budget}. Choose something else or remove an item.` };
        } else {
          const it: BasketItem = {
            productId: url,
            brand: String(args.brand ?? ""),
            name: String(args.product_name ?? ""),
            price,
            category: CATEGORIES.includes(args.category) ? args.category : "complexion",
            tier: TIERS.includes(args.tier) ? args.tier : "mid",
            reason: String(args.reason ?? ""),
            influence: INFLUENCES.includes(args.main_influence) ? args.main_influence : "reviews",
            ...(args.list_item ? { listItem: String(args.list_item) } : {}),
            evidence: looked.evidence ?? (["product page", "new tab", "quicklook", "results tile"].includes(args.evidence) ? args.evidence : url.includes(site.productPath) ? (tabStack.length ? "new tab" : "product page") : "results tile"),
          };
          items.push(it);
          log("add", `${it.brand} ${it.name}, $${it.price} (from ${it.evidence})`, { reason: it.reason, url });
          out = { ok: true, basket_total: total(), remaining: Math.round((cfg.budget - total()) * 100) / 100 };
          emit({ type: "basket", agent: persona.id, items: [...items], total: total() });
        }
        tool("add_to_basket", out.ok ? `Added ${args.brand} ${args.product_name} ($${price})` : String(out.error), args);
      } else if (name === "remove_from_basket") {
        const i = items.findIndex((x) => x.name.toLowerCase() === String(args.product_name ?? "").toLowerCase());
        if (i >= 0) {
          const [gone] = items.splice(i, 1);
          stats.removals++;
          log("remove", `${gone.brand} ${gone.name}`, { reason: args.reason });
          emit({ type: "basket", agent: persona.id, items: [...items], total: total() });
          out = { ok: true, basket_total: total() };
        } else out = { ok: false, error: "That product is not in your basket." };
        tool("remove_from_basket", `Removed ${args.product_name}`, args);
      } else if (name === "compare_products") {
        stats.comparisons++;
        log("compare", `${(args.products ?? []).join(" vs ")} → ${args.winner}`, { reason: args.deciding_factor });
        tool("compare_products", `Compared ${(args.products ?? []).length} products; picked ${args.winner}`, args);
      } else if (name === "reject_product") {
        stats.rejections++;
        log("reject", String(args.product_name ?? ""), { reason: args.reason, url });
        tool("reject_product", `Rejected ${args.product_name}`, args);
      } else if (name === "read_page") {
        const v = await readVisible(page, site.productPath);
        seenLinks = new Set(v.links.map((l) => norm(l.href)));
        if (v.text) seenTexts.set(norm(page.url()), v.text.slice(0, 2500));
        if (productPagesRefused && !page.url().includes(site.productPath)) readAfterRefusal = true;
        out = { url: page.url(), visible_text: v.text, visible_product_links: v.links };
        log("read_page", classifyUrl(page.url(), site.productPath).detail, { url: page.url() });
        tool("read_page", "Read what is on screen", {});
      } else if (name === "open_in_new_tab") {
        const target = String(args.url ?? "");
        const isProduct = (() => {
          try {
            return new URL(target).pathname.includes(site.productPath);
          } catch {
            return false;
          }
        })();
        if (!onAllowedSite(target) || !isProduct || !seenLinks.has(norm(target))) {
          out = { ok: false, error: "Not allowed. open_in_new_tab only opens a product link that read_page just showed on screen. Use the site itself: the search box, menus, filters and product tiles." };
          log("blocked_page", `new tab refused: ${target.slice(0, 120)}`);
          tool("open_in_new_tab", "Refused: only products shown on screen can open in a new tab", args);
        } else {
          const tab = await page.context().newPage(); // the context "page" listener makes it current and remembers the results tab
          await tab.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
          await settle(tab);
          tool("open_in_new_tab", "Opened a product in a new tab", args);
          track(tab.url());
          log("new_tab", target, { url: target });
          const refused = await siteErrorShown(tab);
          out = refused
            ? { ok: false, error: "The store refused this product in the new tab. Do not retry it. Close the tab, try a different product, and if the store keeps refusing, scroll and read the results and decide from the tiles." }
            : { ok: true, url: tab.url(), note: "Opened in a new tab. Use read_page or a screenshot to see it; close_tab returns to the results." };
          if (refused) {
            productPagesRefused = true;
            scrolledAfterRefusal = readAfterRefusal = false;
          } else await rememberProduct(tab);
          if (refused) log("site_blocked", `${site.name.split(" (")[0]} refused a product in a new tab: ${classifyUrl(target, site.productPath).detail}`, { url: target });
        }
      } else if (name === "close_tab") {
        if (!tabStack.length) out = { ok: false, error: "There is no previous tab." };
        else {
          const prev = tabStack.pop()!;
          await page.close().catch(() => {});
          page = prev;
          await page.bringToFront().catch(() => {});
          lastUrl = page.url();
          out = { ok: true, url: page.url(), note: "Back on the previous tab. Take a screenshot to see it." };
          tool("close_tab", "Closed the tab and returned to the results", {});
        }
      } else if (name === "finish_shopping") {
        summary = String(args.summary ?? "");
        if (Array.isArray(args.skipped_items)) skipped = args.skipped_items.map((x: any) => ({ item: String(x.item ?? ""), reason: String(x.reason ?? "") }));
        finished = true;
        log("finish", summary);
        tool("finalize_basket", "Finished shopping", args);
      } else out = { ok: false, error: `Unknown tool ${name}` };
      return out;
    }
  } finally {
    await browser.close().catch(() => {});
  }
}
