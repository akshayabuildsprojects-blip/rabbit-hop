// Prior data: a shopping history Muse considers as the persona's own past purchases.
// For the demo these are synthetic archetype histories (data/prior-data/<persona>-history.csv);
// later, an identified shopper's own history in the same format.

export const PRIOR_COLUMNS = ["date", "store", "brand", "product", "category", "price_usd", "origin", "tier", "main_driver", "discovered_via", "rating_given", "repurchased", "returned", "note"] as const;
export const REQUIRED_COLUMNS = ["brand", "product"] as const;
export const MAX_PRIOR_ROWS = 300;
export const MAX_PRIOR_BYTES = 120_000;

export type PriorRow = Partial<Record<(typeof PRIOR_COLUMNS)[number], string>>;

export interface PriorChoice {
  source: "none" | "archetype" | "upload";
  fileName?: string;
  csv?: string; // upload only
}

export interface PriorData {
  source: "archetype" | "upload";
  fileName: string;
  rows: PriorRow[];
}

// Minimal RFC 4180 parser: quoted fields, escaped quotes, commas and newlines inside quotes.
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((x) => x.trim() !== "")) out.push(row);
      (row = []), (field = "");
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) out.push(row);
  return out;
}

// Parses and checks a history file. Unknown columns are ignored; brand and product are required.
export function readPriorCsv(text: string): { rows: PriorRow[]; error?: string } {
  if (text.length > MAX_PRIOR_BYTES) return { rows: [], error: `The file is too large (over ${Math.round(MAX_PRIOR_BYTES / 1000)} KB).` };
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], error: "The file has no rows." };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) return { rows: [], error: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Expected columns: ${PRIOR_COLUMNS.join(", ")}.` };
  if (table.length - 1 > MAX_PRIOR_ROWS) return { rows: [], error: `Too many rows (${table.length - 1}); the limit is ${MAX_PRIOR_ROWS}.` };
  const rows = table.slice(1).map((cells) => {
    const r: PriorRow = {};
    header.forEach((h, i) => {
      if ((PRIOR_COLUMNS as readonly string[]).includes(h) && cells[i] !== undefined && cells[i].trim() !== "") r[h as keyof PriorRow] = cells[i].trim().slice(0, 200);
    });
    return r;
  }).filter((r) => r.brand && r.product);
  if (!rows.length) return { rows: [], error: "No row has both a brand and a product." };
  return { rows };
}

const count = (xs: (string | undefined)[]) => {
  const c = new Map<string, number>();
  for (const x of xs) if (x) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]);
};
const top = (xs: (string | undefined)[], n: number) => count(xs).slice(0, n).map(([k, v]) => `${k} (${v})`).join(", ");
const yes = (v?: string) => /^(y|yes|true|1)$/i.test(v ?? "");

// Short summary for every shopping step (the full history goes only into the planning step).
export function digestHistory(rows: PriorRow[]): string {
  const prices = rows.map((r) => Number(r.price_usd)).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  const q = (p: number) => prices[Math.min(prices.length - 1, Math.floor(p * prices.length))];
  const repeat = new Map<string, number>();
  for (const r of rows) repeat.set(`${r.brand} ${r.product}`, (repeat.get(`${r.brand} ${r.product}`) ?? 0) + 1);
  const repeated = [...repeat.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  // Also rows marked as repurchased (a different shade or flavor counts as buying it again).
  const flagged = [...new Set(rows.filter((r) => yes(r.repurchased)).map((r) => `${r.brand} ${r.product}`))].filter((k) => !repeat.get(k) || repeat.get(k)! < 2);
  const staples = [...repeated.map(([k, n]) => `${k} (${n}x)`), ...flagged].slice(0, 8);
  const returned = rows.filter((r) => yes(r.returned)).slice(0, 6).map((r) => `${r.brand} ${r.product}${r.note ? `: ${r.note}` : ""}`);
  const lines = [
    `${rows.length} past purchases.`,
    `Brands bought most: ${top(rows.map((r) => r.brand), 8)}.`,
    rows.some((r) => r.origin) ? `Brand origins: ${top(rows.map((r) => r.origin), 7)}.` : "",
    rows.some((r) => r.category) ? `Categories: ${top(rows.map((r) => r.category), 9)}.` : "",
    prices.length ? `Usual price: median $${q(0.5)}, most between $${q(0.25)} and $${q(0.75)}, highest $${prices[prices.length - 1]}.` : "",
    rows.some((r) => r.main_driver) ? `What decided past purchases: ${top(rows.map((r) => r.main_driver), 6)}.` : "",
    rows.some((r) => r.discovered_via) ? `Where products were found: ${top(rows.map((r) => r.discovered_via), 6)}.` : "",
    rows.some((r) => r.store) ? `Stores used: ${top(rows.map((r) => r.store), 6)}.` : "",
    staples.length ? `Bought again: ${staples.join("; ")}.` : "",
    returned.length ? `Returned: ${returned.join("; ")}.` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

// The full history as compact lines, for the planning step.
export function historyLines(rows: PriorRow[]): string {
  return rows
    .map((r) =>
      [r.date, r.store, `${r.brand} ${r.product}`, r.category, r.price_usd ? `$${r.price_usd}` : "", r.origin, r.tier, r.main_driver, r.discovered_via, r.rating_given ? `rated ${r.rating_given}` : "", yes(r.repurchased) ? "bought again" : "", yes(r.returned) ? "returned" : "", r.note]
        .filter(Boolean)
        .join(" | "),
    )
    .join("\n");
}

export const HISTORY_FRAME = `This is your shopping history: what you, as this persona, have bought before, with how it went. Let it shape what you look for, which brands and products you trust, avoid or would buy again, your usual price range and how you search, the way a real shopper's past does. It does not change who you are; your persona comes first. The store may not carry everything you bought before; look for what fits you on this store.`;
