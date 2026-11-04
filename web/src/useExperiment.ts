import { useCallback, useRef, useState } from "react";
import type { AgentEvent, AgentResult, BasketItem, ConsumerContext, JudgeResult, RunShopper, ShoppingMission, StreamMessage } from "../../shared/types";

export interface Step {
  tool: string;
  text: string;
  thought?: string;
}

export interface LaneState {
  status: "idle" | "running" | "done" | "error";
  steps: Step[];
  pendingThought?: string;
  items: BasketItem[];
  total: number;
  summary: string;
  error?: string;
}

export interface RunRequest {
  personaIds: string[];
  context: ConsumerContext;
  mission: Partial<ShoppingMission> & { objective: string; budget: number };
  environment?: string;
  scenarioId?: string;
  minutesPerShopper?: number;
  stepsPerShopper?: number;
  limitBy?: "steps" | "minutes";
  simulationId?: string;
  stores?: string[];
}

export interface RunSetup {
  objective: string;
  budget: number;
  personas: RunShopper[];
  context: ConsumerContext;
  mission: Partial<ShoppingMission>;
  environment: string;
}

export type Phase = "idle" | "shopping" | "judging" | "done" | "error";

const emptyLane = (): LaneState => ({ status: "running", steps: [], items: [], total: 0, summary: "" });

export function useExperiment() {
  const [setup, setSetup] = useState<RunSetup | null>(null);
  const [lanes, setLanes] = useState<Record<string, LaneState>>({});
  const [results, setResults] = useState<AgentResult[] | null>(null);
  const [judge, setJudge] = useState<JudgeResult | null>(null);
  const [judgeError, setJudgeError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ mode: string; model: string; runId: string; simulationId?: string; environment?: string } | null>(null);
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
          lane.pendingThought = e.text;
          break;
        case "tool":
          lane.steps = [...lane.steps, { tool: e.tool, text: e.summary, thought: lane.pendingThought }];
          lane.pendingThought = undefined;
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

  // `preview` lets the UI draw lanes immediately; the server's resolved shoppers replace it.
  // Resolves when the run ends, with its experiment id ("" if it failed or was cancelled).
  const run = useCallback(async (body: RunRequest, preview: RunShopper[]): Promise<{ simulationId: string; completed: boolean }> => {
    let simId = "";
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSetup({ objective: body.mission.objective, budget: body.mission.budget, personas: preview, context: body.context, mission: body.mission, environment: body.environment ?? "sandbox" });
    setLanes(Object.fromEntries(body.personaIds.map((id) => [id, emptyLane()])));
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
      if (!res.ok || !res.body) {
        let msg = `Request failed (${res.status})`;
        try {
          msg = (await res.json()).error ?? msg;
        } catch {}
        throw new Error(msg);
      }
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
          if (msg.kind === "meta") {
            setMeta(msg);
            simId = msg.simulationId ?? "";
            setSetup({ objective: msg.mission.objective, budget: msg.mission.budget, personas: msg.shoppers, context: msg.context, mission: msg.mission, environment: msg.environment ?? "sandbox" });
          }
          else if (msg.kind === "event") apply(msg.event);
          else if (msg.kind === "results") {
            setResults(msg.results);
            setPhase("judging");
          } else if (msg.kind === "judge") setJudge(msg.judge);
          else if (msg.kind === "judge_error") setJudgeError(msg.message);
        }
      }
      setPhase("done");
      return { simulationId: simId, completed: true };
    } catch (err: any) {
      if (err?.name === "AbortError") return { simulationId: simId, completed: false };
      setRunError(err?.message ?? String(err));
      setPhase("error");
      return { simulationId: simId, completed: false };
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setPhase((p) => (p === "shopping" || p === "judging" ? "idle" : p));
  }, []);

  return { setup, lanes, results, judge, judgeError, phase, runError, meta, run, stop };
}

export type Experiment = ReturnType<typeof useExperiment>;
