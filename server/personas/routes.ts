import express, { type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { ConfigError } from "./config.js";
import { MetaApiError, type MetaClient } from "./metaClient.js";
import { getDefinition, loadDefinitions, saveBaseline, UnknownPersonaError } from "./registry.js";
import { IntegrityError, LockedPersonaError, PersonaNotFoundError, PersonaStore } from "./store.js";
import { PersonaValidationError } from "./generator.js";
import { ResearchIncompleteError } from "./research.js";
import { regeneratePersona } from "./pipeline.js";
import { ResearchResultSchema } from "./researchSchema.js";
import type { PersonaProfile } from "./schema.js";

const KNOWN = [ConfigError, MetaApiError, ResearchIncompleteError, PersonaValidationError, LockedPersonaError, PersonaNotFoundError, IntegrityError, UnknownPersonaError];

function statusFor(err: unknown): number {
  if (err instanceof UnknownPersonaError || err instanceof PersonaNotFoundError) return 404;
  if (err instanceof LockedPersonaError) return 409;
  if (err instanceof PersonaValidationError || err instanceof ResearchIncompleteError) return 422;
  if (err instanceof ConfigError) return 503;
  if (err instanceof MetaApiError) return 502;
  return 500;
}

function sendError(res: Response, err: any) {
  const known = KNOWN.some((K) => err instanceof K);
  if (!known) console.error("[personas]", err);
  res.status(statusFor(err)).json({ error: known ? err.message : "Unexpected server error. Check the server log." });
}

// Loads the research evidence JSON that sits next to a report markdown file.
function readResearch(dataDir: string, reportPath: string | undefined) {
  if (!reportPath) return null;
  const md = path.resolve(dataDir, reportPath);
  if (!md.startsWith(path.resolve(dataDir) + path.sep)) return null;
  const json = md.replace(/\.md$/, ".json");
  if (!fs.existsSync(json)) return null;
  const parsed = ResearchResultSchema.safeParse(JSON.parse(fs.readFileSync(json, "utf8")));
  return parsed.success ? parsed.data : null;
}

const sameBaseline = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function personaRouter(opts: { dataDir: string; getClient: () => MetaClient }) {
  const { dataDir } = opts;
  const store = new PersonaStore(dataDir);
  const r = express.Router();

  r.get("/", (_req, res) => {
    try {
      res.json({
        personas: loadDefinitions(dataDir).map((d) => {
          let version: number | null = null;
          let draftVersion: number | null = null;
          let error: string | null = null;
          let baselineChanged = false;
          let hasRetailContext = false;
          try {
            const locked = store.hasLocked(d.persona_id) ? store.loadLocked(d.persona_id) : null;
            const draft = store.hasDraft(d.persona_id) ? store.loadDraft(d.persona_id) : null;
            version = locked?.metadata.version ?? null;
            draftVersion = draft?.metadata.version ?? null;
            const current = (draft ?? locked) as PersonaProfile | null;
            if (current) {
              baselineChanged = !sameBaseline(current.research_evidence.baseline_snapshot ?? null, d.baseline);
              hasRetailContext = Boolean(current.parameter_context);
            }
          } catch (e: any) {
            error = e.message;
          }
          return { ...d, status: store.status(d.persona_id), lockedVersion: version, draftVersion, baselineChanged, hasRetailContext, error };
        }),
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  r.get("/:id", (req, res) => {
    try {
      const def = getDefinition(dataDir, req.params.id);
      const locked = store.hasLocked(def.persona_id) ? store.loadLocked(def.persona_id) : null;
      const draft = store.hasDraft(def.persona_id) ? store.loadDraft(def.persona_id) : null;
      const current = (draft ?? locked) as PersonaProfile | null;
      res.json({
        definition: def,
        status: store.status(def.persona_id),
        draft,
        locked,
        research: readResearch(dataDir, current?.research_evidence.research_report_path),
        retailerResearch: readResearch(dataDir, current?.research_evidence.retailer_research?.report_path),
        lockedResearch: locked && draft ? readResearch(dataDir, locked.research_evidence.research_report_path) : undefined,
        // True when the baseline was edited after the current findings were researched.
        baselineChanged: current ? !sameBaseline(current.research_evidence.baseline_snapshot ?? null, def.baseline) : false,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Configure: saves the persona's baseline hypotheses (its inputs). Findings are only ever
  // produced by research; to change them, change the baseline and regenerate.
  r.put("/:id/baseline", (req, res) => {
    try {
      const def = saveBaseline(dataDir, req.params.id, req.body?.baseline);
      res.json({ definition: def });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Regenerate: persona research, profile, Sephora/Ulta context. Streams NDJSON progress lines.
  r.post("/:id/regenerate", async (req: Request, res: Response) => {
    let def;
    try {
      def = getDefinition(dataDir, req.params.id);
      opts.getClient(); // fail fast if the key is missing
    } catch (err) {
      return sendError(res, err);
    }
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    const send = (m: object) => res.write(JSON.stringify(m) + "\n");
    const heartbeat = setInterval(() => send({ kind: "heartbeat" }), 10_000);
    try {
      const out = await regeneratePersona(opts.getClient(), dataDir, def.persona_id, { log: (message) => send({ kind: "progress", message }) });
      send({ kind: "done", ...out });
    } catch (err: any) {
      const known = KNOWN.some((K) => err instanceof K);
      if (!known) console.error("[personas regenerate]", err);
      send({ kind: "error", message: known ? err.message : "Unexpected server error during regeneration. Check the server log." });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  });

  r.post("/:id/lock", (req, res) => {
    try {
      const def = getDefinition(dataDir, req.params.id);
      if (req.body?.confirm !== def.persona_id) {
        return res.status(400).json({ error: `Locking needs explicit approval: send {"confirm": "${def.persona_id}"}.` });
      }
      const { profile } = store.lock(def.persona_id);
      res.json({ locked: profile });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Discards an unapproved draft (the archived research report is kept).
  r.delete("/:id/draft", (req, res) => {
    try {
      const def = getDefinition(dataDir, req.params.id);
      if (!store.hasDraft(def.persona_id)) throw new PersonaNotFoundError(`'${def.persona_id}' has no draft to discard.`);
      fs.rmSync(store.draftPath(def.persona_id));
      res.json({ ok: true });
    } catch (err) {
      sendError(res, err);
    }
  });

  return r;
}
