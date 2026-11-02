import { useCallback, useRef, useState } from "react";
import type { AgentEvent, AgentResult, BasketItem, JudgeResult, StreamMessage } from "../../shared/types";

export interface LogEntry {
  kind: "thought" | "tool";
  text: string;
  tool?: string;
}

export interface LaneState {
  status: "idle" | "running" | "done" | "error";
  log: LogEntry[];
  items: BasketItem[];
  total: number;
  summary: string;
  error?: string;
}

const emptyLane = (): LaneState => ({ status: "idle", log: [], items: [], total: 0, summary: "" });

export function useExperiment() {
  const [lanes, setLanes] = useState<Record<string, LaneState>>({});
  const [results, setResults] = useState<AgentResult[] | null>(null);
  const [judge, setJudge] = useState<JudgeResult | null>(null);
  const [judgeError, setJudgeError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "shopping" | "judging" | "done" | "error">("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ mode: string; model: string; runId: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const apply = (e: AgentEvent) =>
    setLanes((prev) => {
      const lane = { ...(prev[e.agent] ?? emptyLane()) };
      switch (e.type) {
        case "status":
          lane.status = e.status;
          if (e.message) lane.error = e.message;
          break;
        case "thought":
          lane.log = [...lane.log, { kind: "thought", text: e.text }];
          break;
        case "tool":
          lane.log = [...lane.log, { kind: "tool", text: e.summary, tool: e.tool }];
          break;
        case "basket":
          lane.items = e.items;
          lane.total = e.total;
          break;
        case "final":
          lane.summary = e.summary;
          break;
      }
      return { ...prev, [e.agent]: lane };
    });

  const run = useCallback(async (body: { objective: string; budget: number; personaIds: string[] }) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLanes(Object.fromEntries(body.personaIds.map((id) => [id, { ...emptyLane(), status: "running" as const }])));
    setResults(null);
    setJudge(null);
    setJudgeError(null);
    setRunError(null);
    setPhase("shopping");

    try {
      const res = await fetch("/api/experiment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error((await res.text()) || `Request failed (${res.status})`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line) as StreamMessage;
          if (msg.kind === "meta") setMeta(msg);
          else if (msg.kind === "event") apply(msg.event);
          else if (msg.kind === "results") {
            setResults(msg.results);
            setPhase("judging");
          } else if (msg.kind === "judge") setJudge(msg.judge);
          else if (msg.kind === "judge_error") setJudgeError(msg.message);
          else if (msg.kind === "done") setPhase("done");
        }
      }
      setPhase((p) => (p === "done" ? p : "done"));
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setRunError(err?.message ?? String(err));
      setPhase("error");
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setPhase("idle");
  }, []);

  return { lanes, results, judge, judgeError, phase, runError, meta, run, stop };
}
