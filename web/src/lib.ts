import type { BasketItem, Product, TrendSignal } from "../../shared/types";
import type { Scenario } from "../../shared/scenarios";

export interface Archetype {
  persona_id: string;
  order: number;
  persona_name: string;
  initial_description: string;
  baseline: { motivation: string; characteristics: string[]; shopping_journey: string[]; research_notes?: string };
  ui_color?: string;
}

export interface AppConfig {
  mode: "live" | "simulation";
  model: string;
  retailer: string;
  archetypes: Archetype[];
  anchors: { bands: Record<"low" | "medium" | "high", { min: number; max: number }>; parameters: Record<string, { definition: string; low: string; medium: string; high: string }> };
  trends: TrendSignal[];
  scenarios: Scenario[];
  retailers: { id: string; name: string }[];
  catalog: (Product & { link: string })[];
}

export type LibraryStatus = "not researched" | "draft" | "locked" | "locked + new draft";

export interface LibraryEntry extends Archetype {
  status: LibraryStatus;
  lockedVersion: number | null;
  draftVersion: number | null;
  baselineChanged: boolean;
  hasRetailContext: boolean;
  error: string | null;
}

export const colorOf = (a: { ui_color?: string }) => a.ui_color ?? "#CCCCCC";

export const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
export const moneyRound = (n: number) => `$${Math.round(n)}`;

export const INFLUENCE_LABEL: Record<string, string> = {
  trend: "Trend",
  reviews: "Reviews",
  ingredients: "Ingredients",
  price: "Price",
  brand_prestige: "Prestige",
  dupe: "Dupe",
};

export const TOOL_TAG: Record<string, { label: string; bg: string; fg?: string }> = {
  view_trend_feed: { label: "TREND", bg: "#FF8FB1" },
  search_catalog: { label: "SEARCH", bg: "#E7E4FF" },
  get_product_details: { label: "INSPECT", bg: "#3CC7B5" },
  find_alternatives: { label: "ALTERNATIVES", bg: "#FFD84D" },
  add_to_basket: { label: "ADD", bg: "#FFFFFF" },
  remove_from_basket: { label: "REMOVE", bg: "#FFFFFF" },
  finalize_basket: { label: "CHECKOUT", bg: "#000000", fg: "#FFFFFF" },
  // Live-site (computer use) actions
  page_search: { label: "SEARCH", bg: "#E7E4FF" },
  page_product: { label: "VIEW", bg: "#3CC7B5" },
  page_view: { label: "PAGE", bg: "#F2F2F2" },
  browser_click: { label: "CLICK", bg: "#FFFFFF" },
  browser_double_click: { label: "CLICK", bg: "#FFFFFF" },
  browser_type: { label: "TYPE", bg: "#FFFFFF" },
  browser_keypress: { label: "KEY", bg: "#FFFFFF" },
  browser_scroll: { label: "SCROLL", bg: "#F2F2F2" },
  browser_drag: { label: "DRAG", bg: "#F2F2F2" },
  browser_move: { label: "MOVE", bg: "#F2F2F2" },
  browser_wait: { label: "WAIT", bg: "#F2F2F2" },
  browser_screenshot: { label: "LOOK", bg: "#F2F2F2" },
  search_site: { label: "SEARCH", bg: "#E7E4FF" },
  read_page: { label: "READ", bg: "#F2F2F2" },
  open_link: { label: "OPEN", bg: "#3CC7B5" },
  open_in_new_tab: { label: "NEW TAB", bg: "#3CC7B5" },
  close_tab: { label: "CLOSE TAB", bg: "#F2F2F2" },
  make_plan: { label: "PLAN", bg: "#E7E4FF" },
  compare_products: { label: "COMPARE", bg: "#FFD84D" },
  reject_product: { label: "REJECT", bg: "#FF8FB1" },
};

export function mainDriver(items: BasketItem[]): string {
  if (!items.length) return "None";
  const counts: Record<string, number> = {};
  for (const i of items) counts[i.influence] = (counts[i.influence] ?? 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  return INFLUENCE_LABEL[top] ?? top;
}

export function jaccard(a: BasketItem[], b: BasketItem[]) {
  const A = new Set(a.map((i) => i.productId));
  const B = new Set(b.map((i) => i.productId));
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  return union ? inter / union : 0;
}

export function safeGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
export function safeSet(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {}
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  let body: any = null;
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

// Reads an NDJSON stream line by line.
export async function readNdjson(res: Response, onLine: (msg: any) => void) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onLine(JSON.parse(line));
  }
}
