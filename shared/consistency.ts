import type { AgentResult, ShoppingMission } from "./types";

// Behavioral signature of one shopper run, independent of exact products (live prices and stock change).
export interface BehaviorSignature {
  planEntry?: string; // where its own plan said it would start
  planStyle?: string; // the search style its plan chose
  entry: string; // how it entered the site: search, category menu, brand page, sale, product tile, none
  firstSearch: string | null;
  sort: string; // sort it applied, or "none"
  filters: string[]; // filter parameters it used
  productViews: number;
  comparisons: number;
  rejections: number;
  mainDriver: string; // most common decision driver across its purchases
  mainTier: string; // most common price tier it bought in
  listBought: string[]; // shopping-list items it bought
  brands: string[];
  avgPrice: number;
}

const IGNORE_PARAMS = new Set(["keyword", "q", "query", "page", "currentpage", "sortby", "skuid", "icid", "icid2", "om_mmc", "country_switch", "lang"]);

const mode = (xs: string[]) => {
  const c: Record<string, number> = {};
  for (const x of xs) c[x] = (c[x] ?? 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
};

function entryOf(url: string, kind: string): string {
  if (kind === "search") return "search";
  if (kind === "product_view") return "product tile";
  try {
    const p = new URL(url).pathname.toLowerCase();
    if (p.startsWith("/shop/") || p.startsWith("/categories/")) return "category menu";
    if (p.startsWith("/brand/") || p.startsWith("/brands")) return "brand page";
    if (p.includes("best-sellers") || p.includes("bestseller")) return "best sellers";
    if (p.includes("new-arrivals") || p.startsWith("/new")) return "new arrivals";
    if (p.includes("promotion") || p.includes("hot-deal") || p.includes("deal")) return "promotion";
    if (p.includes("sale")) return "sale";
    if (p === "/" || p === "") return "home";
    return "other page";
  } catch {
    return "other page";
  }
}

export function signatureOf(r: AgentResult, mission?: Partial<ShoppingMission>): BehaviorSignature {
  const acts = r.activity ?? [];
  const navs = acts.filter((a) => ["search", "product_view", "page_view"].includes(a.kind) && a.url);
  const firstNav = navs.find((a, i) => i > 0 || entryOf(a.url!, a.kind) !== "home");
  let sort = "none";
  const filters = new Set<string>();
  for (const a of navs) {
    try {
      const u = new URL(a.url!);
      for (const [k, v] of u.searchParams) {
        const key = k.toLowerCase();
        if (key === "sortby") sort = v || "custom";
        else if (!IGNORE_PARAMS.has(key) && !u.pathname.includes("/product/")) filters.add(key);
      }
    } catch {}
  }
  const list = mission?.shopping_list ?? [];
  const bought = list
    .filter((li) => r.items.some((i) => (i.listItem ?? "").toLowerCase() === li.item.toLowerCase() || i.name.toLowerCase().includes(li.item.toLowerCase())))
    .map((li) => li.item);
  return {
    ...(r.plan ? { planEntry: r.plan.entry.replace(/_/g, " "), planStyle: r.plan.search_style.replace(/_/g, " ") } : {}),
    entry: firstNav ? entryOf(firstNav.url!, firstNav.kind) : "none",
    firstSearch: acts.find((a) => a.kind === "search")?.detail ?? null,
    sort,
    filters: [...filters].sort(),
    productViews: r.stats.productsInspected,
    comparisons: r.stats.comparisons ?? 0,
    rejections: r.stats.rejections ?? 0,
    mainDriver: r.items.length ? mode(r.items.map((i) => i.influence)) : "none",
    mainTier: r.items.length ? mode(r.items.map((i) => i.tier)) : "none",
    listBought: bought,
    brands: [...new Set(r.items.map((i) => i.brand.toLowerCase()))].sort(),
    avgPrice: r.items.length ? Math.round((r.total / r.items.length) * 100) / 100 : 0,
  };
}

export interface ConsistencyField {
  field: string;
  label: string;
  values: string[]; // one per iteration
  agreement: number; // 0 to 1
}

export interface PersonaConsistency {
  personaId: string;
  runs: number;
  score: number; // mean agreement, 0 to 1
  fields: ConsistencyField[];
}

const agreementOf = (values: string[]) => (values.length ? values.filter((v) => v === mode(values)).length / values.length : 0);

function jaccard(a: string[], b: string[]) {
  const A = new Set(a), B = new Set(b);
  const union = new Set([...A, ...B]).size;
  return union ? [...A].filter((x) => B.has(x)).length / union : 1;
}

// How consistently one persona behaved across repeated runs of the same setup.
export function consistencyOf(personaId: string, sigs: BehaviorSignature[]): PersonaConsistency {
  const cat = (field: keyof BehaviorSignature, label: string, fmt: (s: BehaviorSignature) => string): ConsistencyField => {
    const values = sigs.map(fmt);
    return { field, label, values, agreement: agreementOf(values) };
  };
  const views = sigs.map((s) => s.productViews);
  const mean = views.reduce((a, b) => a + b, 0) / (views.length || 1);
  const sd = Math.sqrt(views.reduce((a, b) => a + (b - mean) ** 2, 0) / (views.length || 1));
  let pairs = 0, jac = 0;
  for (let i = 0; i < sigs.length; i++) for (let j = i + 1; j < sigs.length; j++) (pairs++, (jac += jaccard(sigs[i].brands, sigs[j].brands)));
  const hasPlan = sigs.some((s) => s.planEntry);
  const fields: ConsistencyField[] = [
    ...(hasPlan
      ? [cat("planEntry", "Planned start", (s) => s.planEntry ?? "no plan"), cat("planStyle", "Planned search style", (s) => s.planStyle ?? "no plan")]
      : []),
    cat("entry", "How it entered the site", (s) => s.entry),
    cat("sort", "Sorting", (s) => s.sort),
    cat("filters", "Filters used", (s) => (s.filters.length ? s.filters.join(", ") : "none")),
    cat("mainDriver", "Main decision driver", (s) => s.mainDriver),
    cat("mainTier", "Price tier bought", (s) => s.mainTier),
    cat("listBought", "List items bought", (s) => (s.listBought.length ? s.listBought.join(", ") : "none")),
    { field: "productViews", label: "Products viewed", values: views.map(String), agreement: mean ? Math.max(0, 1 - sd / mean) : 1 },
    { field: "brands", label: "Brands bought", values: sigs.map((s) => (s.brands.length ? s.brands.join(", ") : "none")), agreement: pairs ? jac / pairs : 1 },
  ];
  return { personaId, runs: sigs.length, score: fields.reduce((a, f) => a + f.agreement, 0) / fields.length, fields };
}
