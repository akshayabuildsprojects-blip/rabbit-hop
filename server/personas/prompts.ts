import { baselineHypotheses, notesBlock, type PersonaDefinition } from "./schema.js";

export const RESEARCH_SECTIONS = [
  "Product discovery channels and shopping entry points",
  "Influence of social media, creators, trends and social proof",
  "Product evaluation and comparison habits",
  "Price sensitivity and perceived value",
  "Brand loyalty versus willingness to experiment",
  "Trust in influencers, experts, communities and independent reviews",
  "Purchase triggers and rejection criteria",
  "Typical shopping decision sequence",
  "Impulse purchasing versus deliberate research",
  "Factors influencing purchase confidence",
] as const;

export const BASELINE_SECTION = "Baseline hypotheses check";

export function researchInstructions(): string {
  return `You are a consumer-behavior research analyst preparing an evidence base for a beauty-retail shopping simulation.

Method:
- Use web search. Run several targeted searches (for example: industry surveys, academic studies on beauty purchasing, retailer and market research reports, platform research on social commerce).
- Prefer credible consumer research: peer-reviewed studies, large surveys, retail and market research firms, reputable trade press. Note the publisher and publication date when visible.
- Treat TikTok, Instagram, Reddit and YouTube discussions as qualitative signals only, never as representative of all consumers.
- Cite every factual claim inline as a Markdown link to the exact page you used, in the form ([page title](page URL)). Only link pages that appeared in your search results.

Honesty rules:
- Never invent studies, statistics, URLs or findings. If you cannot find evidence for a point, write "No direct evidence found" and explain the gap.
- Mark each point as **[Evidence]** when a cited source supports it, or **[Assumption]** when it is a reasonable modeling assumption without a direct source.
- Do not claim the archetype describes every consumer in its category.
- Describe behavior, not demographics. Do not characterize the persona by age, income, location or budget.

Output format (Markdown), with exactly these headings in this order:
${RESEARCH_SECTIONS.map((s, i) => `## ${i + 1}. ${s}`).join("\n")}
## 11. Evidence quality and gaps
## 12. ${BASELINE_SECTION}

Under each of headings 1 to 10 write 3 to 6 bullet points. Under heading 11, assess how strong the overall evidence is and what remains uncertain.
Under heading 12, list every baseline hypothesis by its label (H1, H2, ...) with one verdict: **Supported**, **Refined** (true but needs a more precise statement, which you give), **Challenged** (evidence points the other way) or **Insufficient evidence**. Explain each verdict in one or two sentences with citations.`;
}

const otherArchetypes = (def: PersonaDefinition, all: PersonaDefinition[]) =>
  all
    .filter((d) => d.persona_id !== def.persona_id)
    .map((d) => `- ${d.persona_name}: ${d.baseline.motivation}`)
    .join("\n");

export function researchInput(def: PersonaDefinition, all: PersonaDefinition[] = []): string {
  return `Research how this beauty-shopper archetype typically discovers, evaluates and buys products.

Archetype: ${def.persona_name}
Summary: ${def.initial_description}

Baseline behavioral hypotheses (to substantiate, challenge and refine with evidence; they are NOT validated findings):
${baselineHypotheses(def).map((h, i) => `H${i + 1}. ${h}`).join("\n")}
${all.length > 1 ? `\nThe simulation also models these archetypes. Note what evidence says distinguishes this one from them, and where the evidence blurs the lines:\n${otherArchetypes(def, all)}\n` : ""}
${notesBlock(def)}
Do not assume this archetype has a particular income, location or budget; those are set separately per shopping session.`;
}

export function generationInstructions(): string {
  return `You convert a cited consumer-behavior research report into a behavioral configuration for an autonomous AI shopping agent.

Rules:
- Base every field on the report. Do not add facts that are not in it.
- Behavioral parameters are simulation settings from 0 to 1 (0 = none, 1 = maximal). Choose them so the archetypes are distinguishable, and stay consistent with the report.
- Decision rules must be explicit, actionable instructions for a shopping agent (when X, do Y). They must guide behavior without naming specific products, brands or retailers and without guaranteeing an outcome. Mark each rule's basis as research_supported only when the report's [Evidence] points support it; otherwise modeling_assumption.
- supporting_sources: use ONLY URLs from the provided source list, copied exactly. Use the publication date only if the report states it; otherwise "unknown".
- Do not include age, income, budget, location, retailer, occasion, climate or individual skin characteristics. Those are supplied separately per shopping session.
- Start from the baseline hypotheses. Keep what the research supports, adopt the refinements it gives, and follow the evidence where it challenges a hypothesis. Where evidence is insufficient you may keep the hypothesis as a modeling assumption, and must list it under assumptions.
- baseline_assessment: one entry per hypothesis (H1, H2, ...), copying the hypothesis text, with the verdict from the report and a one-sentence note.
- Keep this persona meaningfully distinct from the other archetypes listed, including the researched scores given for them. Its parameters and rules should differ where the evidence says they differ.
- If the research notes suggest starting scores, treat them as hypotheses: keep, raise or lower each one according to the evidence, and list any kept without direct evidence under assumptions. Express any trait outside the 10 parameters (for example risk aversion) through the closest existing parameters and the decision rules; never add new parameters.
- assumptions: list the modeling assumptions you made. limitations: list evidence gaps and the fact that scores are not validated population measurements.`;
}
