import { useCallback, useEffect, useState } from "react";
import { api, colorOf, readNdjson, type AppConfig, type LibraryEntry } from "./lib";
import { Markdown } from "./Markdown";
import { DecisionRulesView, ParameterContextView, RetailerPanel, ScenariosView } from "./ContextViews";
import { BEHAVIOR_KEYS, BEHAVIOR_LABEL, type PersonaDetail, type PersonaProfile, type ResearchResult, type ShoppingBehavior } from "./personaTypes";

interface Job {
  running: boolean;
  log: string[];
  startedAt: number;
  error?: string;
}

type Baseline = PersonaDetail["definition"]["baseline"];

const STATUS_STYLE: Record<string, { label: (e: LibraryEntry) => string; bg: string; fg?: string }> = {
  "not researched": { label: () => "Not researched", bg: "#FFFFFF" },
  draft: { label: (e) => `Draft v${e.draftVersion}`, bg: "#FFE14D" },
  locked: { label: (e) => `Locked v${e.lockedVersion}`, bg: "#000000", fg: "#FFFFFF" },
  "locked + new draft": { label: (e) => `Locked v${e.lockedVersion} + draft v${e.draftVersion}`, bg: "#000000", fg: "#FFE14D" },
};

function StatusChip({ entry }: { entry: LibraryEntry }) {
  const s = STATUS_STYLE[entry.status];
  return (
    <span className="inline-flex min-h-6 items-center whitespace-nowrap rounded-full border-2 border-black px-2 text-[11px] font-extrabold" style={{ background: s.bg, color: s.fg }}>
      {s.label(entry)}
    </span>
  );
}

export function PersonaLibrary({ config, onChange }: { config: AppConfig; onChange: () => void }) {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [selected, setSelected] = useState(config.archetypes[0]?.persona_id ?? "");
  const [detail, setDetail] = useState<PersonaDetail | null>(null);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setEntries((await api<{ personas: LibraryEntry[] }>("/api/personas")).personas);
      setLoadError(null);
      onChange();
    } catch (e: any) {
      setLoadError(e.message);
    }
  }, [onChange]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetail(await api<PersonaDetail>(`/api/personas/${id}`));
    } catch (e: any) {
      setLoadError(e.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    setDetail(null);
    if (selected) loadDetail(selected);
  }, [selected, loadDetail]);

  const reloadAll = async (id = selected) => {
    await refresh();
    if (id === selected) await loadDetail(id);
  };

  const regenerate = async (id: string) => {
    setJobs((j) => ({ ...j, [id]: { running: true, log: ["Sending the request to Meta Model API…"], startedAt: Date.now() } }));
    const push = (patch: Partial<Job>, line?: string) => setJobs((j) => ({ ...j, [id]: { ...j[id], ...patch, log: line ? [...j[id].log, line] : j[id].log } }));
    try {
      const res = await fetch(`/api/personas/${id}/regenerate`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Request failed (${res.status})`);
      let failed: string | undefined;
      await readNdjson(res, (m) => {
        if (m.kind === "progress") push({}, m.message);
        else if (m.kind === "done") push({}, `Done: ${m.searches} web searches, ${m.personaSources} persona sources, ${m.retailerSources} Sephora/Ulta sources.`);
        else if (m.kind === "error") failed = m.message;
      });
      if (failed) throw new Error(failed);
      push({ running: false });
    } catch (e: any) {
      push({ running: false, error: e.message });
    }
    await reloadAll(id);
  };

  const entry = entries.find((e) => e.persona_id === selected);

  return (
    <>
      <p className="max-w-[80ch] text-[15px] text-ink-2">
        Configure a persona by setting its baseline hypotheses. Regenerate sends them to Meta Muse Spark, which tests them against consumer and Sephora/Ulta research with live web search
        and produces the findings. Findings are research only and cannot be edited by hand. Approve and lock a persona to use it in shopping runs.
      </p>
      {config.mode !== "live" && (
        <p className="box bg-sun px-4 py-3 text-sm font-semibold">
          Research needs a Meta Model API key. Add <code className="mono">MODEL_API_KEY</code> to the project's .env file and restart the server.
        </p>
      )}
      {loadError && (
        <p role="alert" className="box px-4 py-3 text-sm font-semibold">
          {loadError}
        </p>
      )}

      <div className="flex flex-wrap items-start gap-6">
        <ul className="flex min-w-0 flex-[1_1_260px] flex-col gap-3" aria-label="Personas">
          {entries.map((e) => {
            const on = e.persona_id === selected;
            return (
              <li key={e.persona_id}>
                <button
                  type="button"
                  onClick={() => setSelected(e.persona_id)}
                  aria-current={on}
                  className={`flex w-full items-start gap-3 rounded-md border-2 border-black bg-white px-3.5 py-3 text-left transition-transform ${on ? "-translate-x-0.5 -translate-y-0.5 shadow-[5px_5px_0_#000]" : ""}`}
                >
                  <span className="swatch mt-1 h-[18px] w-[18px]" style={{ background: colorOf(e) }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-extrabold leading-tight">{e.persona_name}</span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <StatusChip entry={e} />
                      {e.baselineChanged && <span className="tag bg-[#FFE4E4]">BASELINE CHANGED</span>}
                      {jobs[e.persona_id]?.running && <span className="text-[11px] font-bold">Regenerating…</span>}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <section className="card min-w-0 flex-[3_1_580px] overflow-hidden" aria-label="Persona">
          {!entry || !detail ? (
            <p className="p-6 text-muted">Loading…</p>
          ) : (
            <PersonaPanel
              key={`${entry.persona_id}-${entry.status}-${entry.draftVersion}-${entry.lockedVersion}`}
              entry={entry}
              detail={detail}
              job={jobs[entry.persona_id]}
              config={config}
              onRegenerate={() => regenerate(entry.persona_id)}
              onReload={() => reloadAll(entry.persona_id)}
            />
          )}
        </section>
      </div>
    </>
  );
}

/* ================= Persona panel ================= */

type Tab = "configure" | "findings";
type Panel = "none" | "regenerate" | "approve";

function PersonaPanel({ entry, detail, job, config, onRegenerate, onReload }: { entry: LibraryEntry; detail: PersonaDetail; job?: Job; config: AppConfig; onRegenerate: () => void; onReload: () => Promise<void> }) {
  const profile = (detail.draft ?? detail.locked) as PersonaProfile | null;
  const isDraft = Boolean(detail.draft);
  const live = config.mode === "live";
  const [tab, setTab] = useState<Tab>(profile ? "findings" : "configure");
  const [panel, setPanel] = useState<Panel>("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextVersion = detail.locked ? detail.locked.metadata.version + 1 : (detail.draft?.metadata.version ?? 1);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setPanel("none");
      await onReload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    { label: "Baseline set", done: true },
    { label: profile ? `Researched ${profile.research_evidence.research_date}` : "Researched", done: Boolean(profile) },
    { label: "Sephora/Ulta context", done: Boolean(profile?.parameter_context) },
    { label: detail.locked ? `Approved v${detail.locked.metadata.version}` : "Approved", done: Boolean(detail.locked) },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-black px-5 py-3.5" style={{ background: colorOf(detail.definition) }}>
        <div className="min-w-0">
          <h2 className="text-lg font-black leading-tight">{detail.definition.persona_name}</h2>
          <span className="mono text-xs font-semibold">{detail.definition.persona_id}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!live || job?.running} onClick={() => setPanel(panel === "regenerate" ? "none" : "regenerate")} className="btn btn-raised min-h-10 py-1.5">
            {profile ? "Regenerate" : "Research with Meta AI"}
          </button>
          {isDraft && (
            <button type="button" disabled={job?.running} onClick={() => setPanel(panel === "approve" ? "none" : "approve")} className="btn btn-ink min-h-10 py-1.5">
              Approve and lock
            </button>
          )}
        </div>
      </div>

      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b-2 border-black bg-wash px-5 py-2.5 text-[12px] font-bold" aria-label="Progress">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-black text-[11px] ${s.done ? "bg-black text-white" : "bg-white"}`} aria-hidden>
              {s.done ? "✓" : i + 1}
            </span>
            <span className={s.done ? "" : "text-muted"}>{s.label}</span>
            {i < steps.length - 1 && <span className="text-muted" aria-hidden>→</span>}
          </li>
        ))}
      </ol>

      {detail.locked && isDraft && (
        <p className="border-b-2 border-black px-5 py-2.5 text-[13px] font-semibold">
          Locked v{detail.locked.metadata.version} stays in use for shopping until you approve draft v{detail.draft!.metadata.version}.
        </p>
      )}
      {detail.baselineChanged && (
        <p className="border-b-2 border-black bg-[#FFE4E4] px-5 py-2.5 text-[13px] font-semibold">
          The baseline changed after these findings were researched. Regenerate so the findings test the new baseline.
        </p>
      )}

      {job?.running && <Progress job={job} />}

      {!job?.running && panel === "regenerate" && (
        <RegeneratePanel
          hasProfile={Boolean(profile)}
          locked={detail.locked}
          nextVersion={nextVersion}
          onCancel={() => setPanel("none")}
          onRun={() => {
            setPanel("none");
            onRegenerate();
          }}
        />
      )}
      {!job?.running && panel === "approve" && isDraft && (
        <ApprovePanel draft={detail.draft!} baselineChanged={detail.baselineChanged} busy={busy} onCancel={() => setPanel("none")}
          onLock={() => act(() => api(`/api/personas/${entry.persona_id}/lock`, { method: "POST", body: JSON.stringify({ confirm: entry.persona_id }) }))}
          onDiscard={() => act(() => api(`/api/personas/${entry.persona_id}/draft`, { method: "DELETE" }))}
        />
      )}

      {!job?.running && (
        <>
          <div role="tablist" aria-label="Persona views" className="flex gap-2 border-b-2 border-black px-5 py-3">
            {(["configure", "findings"] as Tab[]).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`btn min-h-10 px-4 py-1.5 text-[14px] ${tab === t ? "bg-black text-sun" : ""}`}>
                {t === "configure" ? "Configure" : "Findings"}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-4 p-5">
            {job?.error && <ErrorBox message={job.error} />}
            {error && <ErrorBox message={error} />}
            {tab === "configure" && <ConfigureTab detail={detail} hasProfile={Boolean(profile)} live={live} onSaved={onReload} onRegenerate={() => setPanel("regenerate")} />}
            {tab === "findings" &&
              (profile ? (
                <Findings p={profile} research={detail.research} retailerResearch={detail.retailerResearch} config={config} />
              ) : (
                <p className="text-sm text-muted">No findings yet. Set the baseline in Configure, then click Research with Meta AI.</p>
              ))}
          </div>
        </>
      )}
    </>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <p role="alert" className="box whitespace-pre-line bg-[#FFE4E4] px-4 py-3 text-sm font-semibold">
      {message}
    </p>
  );
}

function Progress({ job }: { job: Job }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.floor((now - job.startedAt) / 1000);
  return (
    <div className="flex flex-col gap-4 p-5" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="h-3 w-3 animate-pulse rounded-full border-2 border-black bg-sun" aria-hidden />
        <span className="text-lg font-black">Regenerating with Meta AI</span>
        <span className="mono ml-auto text-sm font-semibold">
          {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
        </span>
      </div>
      <ol className="box flex flex-col gap-2 p-4 text-sm">
        {job.log.map((l, i) => (
          <li key={i} className="flex gap-2">
            <span className="mono text-muted">{String(i + 1).padStart(2, "0")}</span>
            {l}
          </li>
        ))}
      </ol>
      <p className="text-[13px] text-muted">Usually 8 to 10 minutes. You can switch to another persona while this runs. Nothing is saved until all four steps succeed.</p>
    </div>
  );
}

function RegeneratePanel({ hasProfile, locked, nextVersion, onRun, onCancel }: { hasProfile: boolean; locked: PersonaProfile | null; nextVersion: number; onRun: () => void; onCancel: () => void }) {
  const [sure, setSure] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div role="dialog" aria-modal="true" aria-labelledby="regen-title" className="card w-full max-w-[560px] bg-white p-6 text-sm" onClick={(e) => e.stopPropagation()}>
        <h3 id="regen-title" className="text-xl font-black">
          Are you sure you want to regenerate?
        </h3>
        <p className="mt-2">This runs four paid requests to Meta Model API (muse-spark-1.3):</p>
        <ol className="mt-2 list-decimal pl-5 leading-7">
          <li>Persona research with web search, testing the current baseline</li>
          <li>Behavioral profile generated from that research</li>
          <li>Sephora and Ulta Beauty research with web search (US sites only)</li>
          <li>Parameters in context, shopping decisions, retailer behavior and scenarios</li>
        </ol>
        <p className="mt-2">
          About 8 to 10 minutes. The result is saved as <strong>draft v{nextVersion}</strong>
          {locked ? `; locked v${locked.metadata.version} stays in use until you approve it` : hasProfile ? ", replacing the current draft and its findings" : ""}. If any step fails, nothing changes.
        </p>
        <label className="mt-4 flex items-start gap-3 font-semibold">
          <input type="checkbox" autoFocus checked={sure} onChange={(e) => setSure(e.target.checked)} className="mt-0.5 h-5 w-5 accent-black" />
          Yes, run the four Meta requests{hasProfile && !locked ? " and replace the current draft" : ""}.
        </label>
        <div className="mt-4 flex justify-end gap-2.5">
          <button type="button" onClick={onCancel} className="btn">
            Cancel
          </button>
          <button type="button" disabled={!sure} onClick={onRun} className="btn btn-sun btn-raised font-black">
            Regenerate
          </button>
        </div>
      </div>
    </div>
  );
}

function ApprovePanel({ draft, baselineChanged, busy, onLock, onDiscard, onCancel }: { draft: PersonaProfile; baselineChanged: boolean; busy: boolean; onLock: () => void; onDiscard: () => void; onCancel: () => void }) {
  const [checked, setChecked] = useState(false);
  const ba = draft.research_evidence.baseline_assessment;
  const changed = ba.filter((b) => b.verdict === "challenged" || b.verdict === "refined").length;
  const blockers = [baselineChanged && "The baseline changed after this research. Regenerate first.", !draft.parameter_context && "No Sephora/Ulta context yet. Regenerate first."].filter(Boolean) as string[];
  return (
    <div className="flex flex-col gap-3 border-b-2 border-black bg-lilac px-5 py-4 text-sm">
      <h3 className="font-black">Approve and lock draft v{draft.metadata.version}</h3>
      <p>
        {draft.research_evidence.supporting_sources.length} persona sources, {draft.research_evidence.retailer_research?.sources.length ?? 0} Sephora/Ulta sources, {changed} of {ba.length} hypotheses refined or
        challenged. Locking freezes these findings. Shopping agents load them as they are, and later changes need a new version.
      </p>
      {blockers.map((b) => (
        <p key={b} className="font-bold">
          {b}
        </p>
      ))}
      <label className="flex items-start gap-3 font-semibold">
        <input type="checkbox" checked={checked} disabled={blockers.length > 0} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-5 w-5 accent-black" />
        I reviewed the findings and sources and approve this persona for shopping runs.
      </label>
      <div className="flex flex-wrap gap-2.5">
        <button type="button" disabled={!checked || busy || blockers.length > 0} onClick={onLock} className="btn btn-sun btn-raised font-black">
          Approve and lock v{draft.metadata.version}
        </button>
        <button type="button" disabled={busy} onClick={onDiscard} className="btn">
          Discard draft
        </button>
        <button type="button" onClick={onCancel} className="btn">
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ================= Configure ================= */

const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

function ConfigureTab({ detail, hasProfile, live, onSaved, onRegenerate }: { detail: PersonaDetail; hasProfile: boolean; live: boolean; onSaved: () => Promise<void>; onRegenerate: () => void }) {
  const b = detail.definition.baseline;
  const initial = { motivation: b.motivation, characteristics: b.characteristics.join("\n"), journey: b.shopping_journey.join("\n"), notes: b.research_notes ?? "" };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const journey = lines(form.journey);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const baseline: Baseline = { motivation: form.motivation.trim(), characteristics: lines(form.characteristics), shopping_journey: journey, ...(form.notes.trim() ? { research_notes: form.notes.trim() } : {}) };
      await api(`/api/personas/${detail.definition.persona_id}/baseline`, { method: "PUT", body: JSON.stringify({ baseline }) });
      setSaved(true);
      await onSaved();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <p className="text-[13px] text-muted">
        The baseline is your starting hypothesis for how this shopper behaves. Research tests each point and reports it as supported, refined, challenged or lacking evidence. Do not include
        income, location or budget; those are set per shopping run.
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="b-motivation" className="text-[13px] font-bold">
          Motivation
        </label>
        <textarea id="b-motivation" rows={2} className="field resize-y text-sm" value={form.motivation} onChange={(e) => setForm({ ...form, motivation: e.target.value })} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="b-chars" className="text-[13px] font-bold">
          Characteristics <span className="font-normal text-muted">(one per line)</span>
        </label>
        <textarea id="b-chars" rows={6} className="field resize-y text-sm leading-relaxed" value={form.characteristics} onChange={(e) => setForm({ ...form, characteristics: e.target.value })} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="b-journey" className="text-[13px] font-bold">
          Shopping journey <span className="font-normal text-muted">(one step per line, in order)</span>
        </label>
        <textarea id="b-journey" rows={4} className="field resize-y text-sm" value={form.journey} onChange={(e) => setForm({ ...form, journey: e.target.value })} />
        {journey.length > 0 && (
          <ol className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] font-semibold" aria-label="Journey preview">
            {journey.map((step, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <span className="box rounded px-2 py-1">{step}</span>
                {i < journey.length - 1 && <span aria-hidden>→</span>}
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="b-notes" className="text-[13px] font-bold">
          Research notes <span className="font-normal text-muted">(optional: topics to investigate, guardrails, starting score guesses, situations to cover)</span>
        </label>
        <textarea id="b-notes" rows={8} className="field resize-y text-sm leading-relaxed" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
      {error && <ErrorBox message={error} />}
      <div className="flex flex-wrap items-center gap-2.5">
        <button type="button" disabled={!dirty || saving} onClick={save} className="btn btn-ink">
          {saving ? "Saving…" : "Save baseline"}
        </button>
        <button type="button" disabled={!dirty || saving} onClick={() => setForm(initial)} className="btn">
          Undo changes
        </button>
        {saved && !dirty && (
          <span className="flex flex-wrap items-center gap-2.5 text-[13px] font-bold">
            Baseline saved.
            {hasProfile && live && (
              <button type="button" onClick={onRegenerate} className="btn btn-sun min-h-9 py-1">
                Regenerate findings
              </button>
            )}
          </span>
        )}
      </div>
    </>
  );
}

/* ================= Findings ================= */

type Section = "summary" | "parameters" | "decisions" | "sephora" | "ulta" | "scenarios" | "sources";
const SECTIONS: { id: Section; label: string; needsContext?: boolean }[] = [
  { id: "summary", label: "Summary" },
  { id: "parameters", label: "Parameters", needsContext: true },
  { id: "decisions", label: "Decisions", needsContext: true },
  { id: "sephora", label: "Sephora", needsContext: true },
  { id: "ulta", label: "Ulta", needsContext: true },
  { id: "scenarios", label: "Scenarios", needsContext: true },
  { id: "sources", label: "Sources" },
];

function Findings({ p, research, retailerResearch, config }: { p: PersonaProfile; research: ResearchResult | null; retailerResearch?: ResearchResult | null; config: AppConfig }) {
  const [section, setSection] = useState<Section>("summary");
  const hasContext = Boolean(p.parameter_context);
  const current = SECTIONS.find((s) => s.id === section)!;
  return (
    <>
      <p className="text-[13px] text-muted">
        Research findings for v{p.metadata.version}, generated {new Date(p.metadata.generated_at).toLocaleDateString()}. Read-only: change the baseline in Configure and regenerate to change them.
      </p>
      <nav aria-label="Findings sections" className="flex flex-wrap gap-1.5">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-current={s.id === section}
            onClick={() => setSection(s.id)}
            className={`chip min-h-9 ${s.id === section ? "bg-black text-white" : ""} ${s.needsContext && !hasContext ? "opacity-50" : ""}`}
          >
            {s.label}
          </button>
        ))}
      </nav>
      {current.needsContext && !hasContext ? (
        <p className="box bg-sun px-4 py-3 text-sm font-semibold">This version has no Sephora/Ulta context yet. Regenerate to add it.</p>
      ) : (
        <>
          {section === "summary" && <Summary p={p} />}
          {section === "parameters" && <ParameterContextView p={p} config={config} />}
          {section === "decisions" && <DecisionRulesView p={p} />}
          {section === "sephora" && <RetailerPanel b={p.retailer_behavior!.sephora} />}
          {section === "ulta" && <RetailerPanel b={p.retailer_behavior!.ulta} />}
          {section === "scenarios" && <ScenariosView p={p} />}
          {section === "sources" && <Sources p={p} research={research} retailerResearch={retailerResearch} />}
        </>
      )}
    </>
  );
}

const VERDICT_STYLE: Record<string, { label: string; bg: string }> = {
  supported: { label: "SUPPORTED", bg: "#3CC7B5" },
  refined: { label: "REFINED", bg: "#8FD3FF" },
  challenged: { label: "CHALLENGED", bg: "#FF8FB1" },
  insufficient_evidence: { label: "INSUFFICIENT EVIDENCE", bg: "#FFFFFF" },
};

const LIST_FIELDS: { key: keyof ShoppingBehavior; label: string }[] = [
  { key: "preferred_discovery_channels", label: "Discovery channels" },
  { key: "trusted_information_sources", label: "Trusted sources (priority order)" },
  { key: "product_evaluation_criteria", label: "Evaluation criteria" },
  { key: "purchase_triggers", label: "Purchase triggers" },
  { key: "rejection_criteria", label: "Rejection criteria" },
  { key: "typical_shopping_sequence", label: "Typical shopping sequence" },
];

function Summary({ p }: { p: PersonaProfile }) {
  const sb = p.shopping_behavior;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[15px] leading-relaxed">{p.description}</p>
        <p className="mt-2 text-sm">
          <span className="font-extrabold">Primary motivation:</span> {p.primary_motivation}
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <div className="box min-w-0 flex-[3_1_380px] p-4">
          <h3 className="text-sm font-black tracking-wide">BEHAVIORAL SCORES</h3>
          <p className="mb-2.5 text-xs text-muted">{p.behavioral_parameters.note}</p>
          <div className="grid gap-x-6 gap-y-2.5 [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
            {BEHAVIOR_KEYS.map((k) => (
              <div key={k} className="grid grid-cols-[124px_1fr_40px] items-center gap-2.5 text-[13px]">
                <span className="font-bold leading-tight">{BEHAVIOR_LABEL[k]}</span>
                <span className="h-3 rounded-sm border-2 border-black bg-wash">
                  <span className="block h-full bg-black" style={{ width: `${p.behavioral_parameters[k] * 100}%` }} />
                </span>
                <span className="mono text-right font-semibold">{p.behavioral_parameters[k].toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="box min-w-0 flex-[2_1_280px] p-4">
          <h3 className="text-sm font-black tracking-wide">BASELINE HYPOTHESES CHECK</h3>
          <ul className="mt-2 flex flex-col gap-2.5">
            {p.research_evidence.baseline_assessment.map((b, i) => (
              <li key={i} className="text-[13px] leading-snug">
                <span className="tag mr-1.5" style={{ background: VERDICT_STYLE[b.verdict].bg }}>
                  {VERDICT_STYLE[b.verdict].label}
                </span>
                <span className="font-semibold">{b.hypothesis}</span>
                <span className="mt-0.5 block text-muted">{b.note}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(230px,1fr))]">
        {LIST_FIELDS.map((f) => (
          <div key={f.key} className="box p-4">
            <h3 className="text-[13px] font-black">{f.label}</h3>
            {f.key === "typical_shopping_sequence" ? (
              <ol className="mt-1.5 list-decimal pl-5 text-[13px] leading-relaxed">{(sb[f.key] as string[]).map((x, i) => <li key={i}>{x}</li>)}</ol>
            ) : (
              <ul className="mt-1.5 list-disc pl-5 text-[13px] leading-relaxed">{(sb[f.key] as string[]).map((x, i) => <li key={i}>{x}</li>)}</ul>
            )}
          </div>
        ))}
        <div className="box p-4">
          <h3 className="text-[13px] font-black">Comparison strategy</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed">{sb.comparison_strategy}</p>
        </div>
      </div>
      <div className="box p-4">
        <h3 className="text-sm font-black tracking-wide">CORE DECISION RULES</h3>
        <ul className="mt-2 flex flex-col gap-2">
          {p.decision_rules.map((r, i) => (
            <li key={i} className="text-[13px] leading-snug">
              <span className="tag mr-1.5" style={{ background: r.basis === "research_supported" ? "#3CC7B5" : "#FFE14D" }}>
                {r.basis === "research_supported" ? "EVIDENCE" : "ASSUMPTION"}
              </span>
              <span className="font-semibold">{r.rule}</span>
            </li>
          ))}
        </ul>
      </div>
      {p.expected_observable_actions && (
        <div className="box p-4">
          <h3 className="text-sm font-black tracking-wide">WHAT THE AGENT SHOULD VISIBLY DO</h3>
          <div className="mt-2 grid gap-3 text-[13px] [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
            {(
              [
                ["Discovery", p.expected_observable_actions.discovery],
                ["Browsing", p.expected_observable_actions.browsing],
                ["Comparison", p.expected_observable_actions.comparison],
                ["Purchase", p.expected_observable_actions.purchase],
                ["Rejection or substitution", p.expected_observable_actions.rejection_or_substitution],
              ] as [string, string[]][]
            ).map(([t, xs]) => (
              <div key={t}>
                <span className="font-black">{t}</span>
                <ul className="mt-1 list-disc pl-5 leading-relaxed">
                  {xs.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
        <div className="box p-4">
          <h3 className="text-sm font-black tracking-wide">MODELING ASSUMPTIONS</h3>
          <ul className="mt-2 list-disc pl-5 text-[13px] leading-relaxed">{p.research_evidence.assumptions.length ? p.research_evidence.assumptions.map((a, i) => <li key={i}>{a}</li>) : <li>None listed</li>}</ul>
        </div>
        <div className="box p-4">
          <h3 className="text-sm font-black tracking-wide">LIMITATIONS</h3>
          <ul className="mt-2 list-disc pl-5 text-[13px] leading-relaxed">
            {p.research_evidence.limitations.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Sources({ p, research, retailerResearch }: { p: PersonaProfile; research: ResearchResult | null; retailerResearch?: ResearchResult | null }) {
  const [which, setWhich] = useState<"persona" | "retail">("persona");
  const r = which === "persona" ? research : retailerResearch;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Reports">
        <button type="button" role="tab" aria-selected={which === "persona"} onClick={() => setWhich("persona")} className={`chip min-h-9 ${which === "persona" ? "bg-black text-white" : ""}`}>
          Persona research
        </button>
        <button type="button" role="tab" aria-selected={which === "retail"} onClick={() => setWhich("retail")} className={`chip min-h-9 ${which === "retail" ? "bg-black text-white" : ""}`}>
          Sephora and Ulta research
        </button>
      </div>
      {!r ? (
        <p className="text-sm text-muted">This report is not available for this version.</p>
      ) : (
        <div className="flex flex-wrap items-start gap-5">
          <div className="min-w-0 flex-[2_1_380px]">
            <p className="mb-2 text-xs text-muted">
              {r.model}, {r.web_search_calls} web searches, {r.considered_results.length} pages considered, {r.sources.length} cited, {new Date(r.performed_at).toLocaleString()}.
            </p>
            <div className="box max-h-[540px] overflow-y-auto px-5 py-4">
              <Markdown text={r.report_text} />
            </div>
          </div>
          <aside className="box min-w-0 flex-[1_1_240px] p-4">
            <h3 className="text-sm font-black tracking-wide">CITED SOURCES</h3>
            {which === "persona" && <p className="mt-1 text-[13px] leading-relaxed">{p.research_evidence.evidence_summary}</p>}
            <ol className="mt-2 flex list-decimal flex-col gap-2 pl-5 text-[13px] leading-snug">
              {r.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer" className="font-semibold underline decoration-2 underline-offset-2">
                    {s.title || s.url}
                  </a>
                  <span className="block break-all text-[11px] text-muted">{new URL(s.url).hostname}</span>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      )}
    </div>
  );
}
