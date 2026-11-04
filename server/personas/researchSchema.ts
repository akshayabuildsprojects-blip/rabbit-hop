import { z } from "zod";
import { PersonaIdSchema } from "./schema.js";

export const CitationSchema = z.object({
  url: z.string(),
  title: z.string(),
  start_index: z.number().int().nonnegative().optional(),
  end_index: z.number().int().nonnegative().optional(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const SearchResultSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  snippet: z.string().optional(),
});

export const ResearchResultSchema = z.object({
  persona_id: PersonaIdSchema,
  research_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  performed_at: z.string(),
  model: z.string(),
  response_id: z.string(),
  web_search_calls: z.number().int().nonnegative(),
  report_text: z.string(),
  // Meta's url_citation annotations, preserved exactly as returned (offsets refer to report_text).
  annotations: z.array(CitationSchema),
  // Unique cited sources, derived from annotations.
  sources: z.array(z.object({ url: z.string(), title: z.string() })),
  // Every source the model considered (web_search_call.results), when returned.
  considered_results: z.array(SearchResultSchema),
  // Inline Markdown links in the report whose URL appears in the search results above.
  // Used when Meta returns no url_citation annotations; links to unseen pages are dropped.
  inline_citations: z.array(z.object({ url: z.string(), title: z.string() })).default([]),
  // How sources were attached: Meta's url_citation annotations, verified inline links, or a
  // follow-up mapping of claims to search results Meta actually returned.
  citation_method: z.enum(["annotations", "inline_links", "mapped_to_search_results", "none"]).default("none"),
  citation_map: z.array(z.object({ claim: z.string(), urls: z.array(z.string()) })).default([]),
  usage: z.record(z.string(), z.unknown()).nullable(),
});
export type ResearchResult = z.infer<typeof ResearchResultSchema>;
