import path from "node:path";
import type { MetaClient } from "./metaClient.js";
import { runResearch, saveResearchReport } from "./research.js";
import { generateProfile } from "./generator.js";
import { runEnrichment } from "./enrich.js";
import { getDefinition, loadDefinitions } from "./registry.js";
import { PersonaStore } from "./store.js";

export interface ResearchRunResult {
  draftPath: string;
  reportPath: string;
  evidencePath: string;
  version: number;
  sources: number;
  searches: number;
}

// select persona -> web research -> save report -> generate JSON -> validate -> save draft
export async function researchAndDraft(
  client: MetaClient,
  dataDir: string,
  personaId: string,
  opts: { newVersion?: boolean; log?: (msg: string) => void; now?: Date } = {},
): Promise<ResearchRunResult> {
  const log = opts.log ?? (() => {});
  const store = new PersonaStore(dataDir);
  const def = getDefinition(dataDir, personaId);
  const version = store.nextVersion(def.persona_id, !!opts.newVersion);

  log(`Researching '${def.persona_name}' with Meta web search. This usually takes 1 to 3 minutes…`);
  const all = loadDefinitions(dataDir);
  const research = await runResearch(client, def, all, opts.now);
  const { markdownPath, jsonPath } = saveResearchReport(dataDir, research, def);
  log(`Research saved: ${research.web_search_calls} searches, ${research.sources.length} cited sources.`);

  log("Generating the structured persona profile…");
  const profile = await generateProfile(client, def, research, { reportPath: path.relative(dataDir, markdownPath), version, now: opts.now, all });
  const draftPath = store.saveDraft(profile);
  return { draftPath, reportPath: markdownPath, evidencePath: jsonPath, version, sources: profile.research_evidence.supporting_sources.length, searches: research.web_search_calls };
}

// Configure → Regenerate: persona research, profile, then Sephora/Ulta context, saved once at
// the end so a failure leaves the existing draft (or locked version) untouched. A locked
// persona is never changed: regeneration produces the next version as a draft.
export async function regeneratePersona(
  client: MetaClient,
  dataDir: string,
  personaId: string,
  opts: { log?: (msg: string) => void; now?: Date } = {},
): Promise<{ version: number; personaSources: number; retailerSources: number; searches: number }> {
  const log = opts.log ?? (() => {});
  const store = new PersonaStore(dataDir);
  const def = getDefinition(dataDir, personaId);
  const version = store.nextVersion(def.persona_id, true);
  const all = loadDefinitions(dataDir);

  log(`Step 1 of 4: researching '${def.persona_name}' with Meta web search (1 to 3 minutes)…`);
  const research = await runResearch(client, def, all, opts.now);
  const { markdownPath } = saveResearchReport(dataDir, research, def);
  log(`Research saved: ${research.web_search_calls} searches, ${research.sources.length} cited sources.`);

  log("Step 2 of 4: generating the behavioral profile from the research…");
  const peerScores = all
    .filter((d) => d.persona_id !== def.persona_id)
    .map((d) => {
      try {
        const p = store.hasDraft(d.persona_id) ? store.loadDraft(d.persona_id) : store.hasLocked(d.persona_id) ? store.loadLocked(d.persona_id) : null;
        if (!p) return "";
        const b = p.behavioral_parameters as Record<string, number | string>;
        return `- ${d.persona_name}: ${Object.entries(b).filter(([k]) => k !== "note").map(([k, v]) => `${k} ${Number(v).toFixed(2)}`).join(", ")}`;
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .join("\n");
  const profile = await generateProfile(client, def, research, { reportPath: path.relative(dataDir, markdownPath), version, now: opts.now, all, peerScores });

  log("Step 3 of 4: researching Sephora and Ulta Beauty (US sites)…");
  const { profile: enriched } = await runEnrichment(client, dataDir, def, profile, research, (m) => log(m.startsWith("Translating") ? `Step 4 of 4: ${m}` : m), opts.now);

  store.saveDraft(enriched);
  log(`Draft v${version} saved.`);
  return {
    version,
    personaSources: enriched.research_evidence.supporting_sources.length,
    retailerSources: enriched.research_evidence.retailer_research?.sources.length ?? 0,
    searches: research.web_search_calls + (enriched.research_evidence.retailer_research?.web_search_calls ?? 0),
  };
}
