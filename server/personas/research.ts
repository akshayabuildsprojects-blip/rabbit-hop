import fs from "node:fs";
import path from "node:path";
import { META, RESEARCH_REQUIREMENTS } from "./config.js";
import type { PersonaDefinition } from "./schema.js";
import { ResearchResultSchema, type Citation, type ResearchResult } from "./researchSchema.js";
import { outputText, type MetaClient, type ResponseLike } from "./metaClient.js";
import { BASELINE_SECTION, RESEARCH_SECTIONS, researchInput, researchInstructions } from "./prompts.js";

export class ResearchIncompleteError extends Error {
  constructor(
    message: string,
    public problems: string[],
  ) {
    super(`${message}\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
}

export function buildResearchRequest(def: PersonaDefinition, all: PersonaDefinition[] = []) {
  return {
    model: META.model,
    instructions: researchInstructions(),
    input: researchInput(def, all),
    tools: [{ type: "web_search", search_context_size: "high" }],
    include: ["web_search_call.results"],
    reasoning: { effort: "high" },
    store: false,
  };
}

// Pulls citations, search calls and considered results out of a Responses API object.
export function parseResearchResponse(def: PersonaDefinition, res: ResponseLike, now = new Date()): ResearchResult {
  const text = outputText(res);
  const annotations: Citation[] = res.output
    .filter((o) => o.type === "message")
    .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((c: any) => c.type === "output_text")
    .flatMap((c: any) => (Array.isArray(c.annotations) ? c.annotations : []))
    .filter((a: any) => a?.type === "url_citation" && typeof a.url === "string")
    .map((a: any) => ({ url: a.url, title: String(a.title ?? ""), start_index: a.start_index, end_index: a.end_index }));

  const searchCalls = res.output.filter((o) => o.type === "web_search_call");
  const considered = searchCalls
    .flatMap((c) => (Array.isArray(c.results) ? c.results : []))
    .filter((r: any) => typeof r?.url === "string")
    .map((r: any) => ({ url: r.url, title: r.title, snippet: r.snippet }));

  const seen = new Map<string, string>();
  for (const a of annotations) if (!seen.has(a.url)) seen.set(a.url, a.title);

  // Fallback for responses without annotations: inline links, verified against what was searched.
  const norm = (u: string) => u.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
  const consideredByUrl = new Map(considered.map((c: any) => [norm(c.url), c]));
  const inline: { url: string; title: string }[] = [];
  for (const m of text.matchAll(/\[([^\]]{1,200})\]\((https?:\/\/[^)\s]+)\)/g)) {
    const hit = consideredByUrl.get(norm(m[2]));
    if (!hit || inline.some((x) => norm(x.url) === norm(m[2]))) continue;
    inline.push({ url: hit.url, title: hit.title || m[1] });
  }
  for (const c of inline) if (![...seen.keys()].some((u) => norm(u) === norm(c.url))) seen.set(c.url, c.title);

  return ResearchResultSchema.parse({
    persona_id: def.persona_id,
    research_date: now.toISOString().slice(0, 10),
    performed_at: now.toISOString(),
    model: res.model ?? META.model,
    response_id: res.id,
    web_search_calls: searchCalls.length,
    report_text: text,
    annotations,
    sources: [...seen.entries()].map(([url, title]) => ({ url, title })),
    considered_results: considered,
    inline_citations: inline,
    citation_method: annotations.length ? "annotations" : inline.length ? "inline_links" : "none",
    citation_map: [],
    usage: (res.usage as Record<string, unknown>) ?? null,
  });
}

// Rejects research that did not actually search, cite, or cover the required dimensions.
export function assertResearchComplete(r: ResearchResult, req = RESEARCH_REQUIREMENTS) {
  const problems: string[] = [];
  if (r.web_search_calls < req.minWebSearchCalls) problems.push("The model did not perform a web search (no web_search_call in the response).");
  if (r.sources.length < req.minUniqueSources) problems.push(`Only ${r.sources.length} unique cited source(s); at least ${req.minUniqueSources} are required.`);
  if (r.report_text.length < req.minReportChars) problems.push(`Report is too short (${r.report_text.length} characters; minimum ${req.minReportChars}).`);
  const missing = RESEARCH_SECTIONS.map((_, i) => i + 1).filter((n) => !new RegExp(`^##\\s*${n}\\.`, "m").test(r.report_text));
  if (missing.length) problems.push(`Report is missing required section(s): ${missing.join(", ")}.`);
  if (!/^##\s*12\./m.test(r.report_text)) problems.push(`Report is missing section 12 (${BASELINE_SECTION}), so the baseline hypotheses were not evaluated.`);
  if (problems.length) throw new ResearchIncompleteError(`Research for '${r.persona_id}' is incomplete, so no draft was created.`, problems);
}

export async function runResearch(client: MetaClient, def: PersonaDefinition, all: PersonaDefinition[] = [], now = new Date()): Promise<ResearchResult> {
  const res = await client.createResponse(buildResearchRequest(def, all));
  let result = parseResearchResponse(def, res, now);
  if (result.sources.length < RESEARCH_REQUIREMENTS.minUniqueSources && result.considered_results.length) result = await mapCitations(client, result);
  assertResearchComplete(result);
  return result;
}

// Writes a human-readable report (Markdown with citations) plus the raw evidence (JSON).
export function saveResearchReport(
  dataDir: string,
  r: ResearchResult,
  def: PersonaDefinition,
  opts: { suffix?: string; title?: string; legend?: string } = {},
): { markdownPath: string; jsonPath: string } {
  const dir = path.join(dataDir, "research-reports", r.persona_id);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = r.performed_at.replace(/[:.]/g, "-") + (opts.suffix ? `-${opts.suffix}` : "");
  const markdownPath = path.join(dir, `${stamp}.md`);
  const jsonPath = path.join(dir, `${stamp}.json`);
  const legend =
    opts.legend ??
    "Points are marked **[Evidence]** (cited) or **[Assumption]** (modeling assumption). Social-media discussions are qualitative signals, not representative samples.";

  const md = `# ${opts.title ?? "Consumer behavior research"}: ${def.persona_name}

| | |
|---|---|
| Persona id | \`${r.persona_id}\` |
| Research performed | ${r.performed_at} |
| Model | ${r.model} via Meta Model API (Responses API, \`web_search\` tool) |
| Response id | \`${r.response_id}\` |
| Web searches run | ${r.web_search_calls} |
| Unique cited sources | ${r.sources.length} |
| Sources considered | ${r.considered_results.length || "not returned"} |
| How sources were attached | ${{ annotations: "Meta url_citation annotations", inline_links: "Inline links verified against search results", mapped_to_search_results: "Claims mapped to Meta search results after research", none: "None" }[r.citation_method]} |

> Generated by Muse Spark with live web search. ${legend} Review before approving the persona.

---

${r.report_text}

---

## Cited sources

${r.sources.map((s, i) => `${i + 1}. [${s.title || s.url}](${s.url})`).join("\n")}
${
  r.citation_map.length
    ? `\n## Claim-to-source mapping\n\nAttached after research by matching each claim to search results Meta returned. Review before relying on it.\n\n${r.citation_map.map((c) => `- ${c.claim}\n  ${c.urls.map((u) => `[${new URL(u).hostname}](${u})`).join(", ")}`).join("\n")}\n`
    : ""
}`;
  fs.writeFileSync(markdownPath, md);
  fs.writeFileSync(jsonPath, JSON.stringify(r, null, 2) + "\n");
  return { markdownPath, jsonPath };
}

/* ---------- Citation mapping fallback ---------- */

const CITATION_MAP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["citations"],
  properties: {
    citations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "result_ids"],
        properties: { claim: { type: "string", description: "The claim, copied briefly from the report" }, result_ids: { type: "array", items: { type: "integer" } } },
      },
    },
  },
};

// When a report has no usable citations, ask the model which of the search results Meta
// actually returned support each claim. Only ids from the list are accepted, so every
// cited URL is a page that was retrieved during research.
export async function mapCitations(client: MetaClient, r: ResearchResult): Promise<ResearchResult> {
  const results = r.considered_results.filter((c, i, all) => all.findIndex((x) => x.url === c.url) === i).slice(0, 300);
  if (!results.length) return r;
  const list = results.map((c, i) => `[${i}] ${c.title ?? ""} | ${c.url}${c.snippet ? ` | ${c.snippet.slice(0, 200)}` : ""}`).join("\n");
  const res = await client.createResponse({
    model: META.model,
    instructions:
      "You attach sources to a research report. For each factual claim in the report (skip points marked [Inference] or [Assumption]), list the ids of the search results below that the claim most plausibly came from, judging by title, URL and snippet. Use only ids from the list. If no result plausibly supports a claim, return an empty list for it. Never guess.",
    input: `Search results retrieved during research:\n${list}\n\nReport:\n"""\n${r.report_text}\n"""`,
    text: { format: { type: "json_schema", name: "citation_map", schema: CITATION_MAP_SCHEMA, strict: true } },
    reasoning: { effort: "low" },
    store: false,
  });
  let parsed: { citations?: { claim: string; result_ids: number[] }[] } = {};
  try {
    const raw = outputText(res);
    parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    return r;
  }
  const citation_map = (parsed.citations ?? [])
    .map((c) => ({ claim: String(c.claim ?? "").slice(0, 300), urls: [...new Set((c.result_ids ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < results.length).map((i) => results[i].url))] }))
    .filter((c) => c.claim && c.urls.length);
  const used = new Map<string, string>(r.sources.map((x) => [x.url, x.title]));
  for (const c of citation_map) for (const u of c.urls) if (!used.has(u)) used.set(u, results.find((x) => x.url === u)?.title || u);
  return ResearchResultSchema.parse({
    ...r,
    sources: [...used.entries()].map(([url, title]) => ({ url, title })),
    citation_method: citation_map.length ? "mapped_to_search_results" : r.citation_method,
    citation_map,
  });
}
