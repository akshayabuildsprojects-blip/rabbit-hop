import type { Category } from "./types";

// Curated shopping scenarios for the MVP. Every shopper in a run gets the same scenario,
// so differences in what they buy come from the persona, not the brief.
export type Priority = "must" | "preferred" | "nice";

export interface ScenarioItem {
  item: string;
  priority: Priority;
  category: Category;
}

export interface Scenario {
  id: string;
  title: string;
  why: string;
  budget: number;
  items: ScenarioItem[];
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  must: "Must have",
  preferred: "Highly preferred",
  nice: "Nice to have",
};

export const SCENARIOS: Scenario[] = [
  {
    id: "new-vanity",
    title: "New vanity",
    why: "You are setting up a new everyday makeup routine from scratch.",
    budget: 150,
    items: [
      { item: "Foundation", priority: "must", category: "complexion" },
      { item: "Blush", priority: "preferred", category: "cheek" },
      { item: "Mascara", priority: "nice", category: "eyes" },
    ],
  },
  {
    id: "running-low",
    title: "Running low",
    why: "You are restocking everyday basics that are about to run out.",
    budget: 80,
    items: [
      { item: "Foundation", priority: "must", category: "complexion" },
      { item: "Concealer", priority: "preferred", category: "complexion" },
      { item: "Setting powder", priority: "nice", category: "complexion" },
    ],
  },
  {
    id: "night-out",
    title: "Night out",
    why: "You are getting ready for a special event this weekend.",
    budget: 100,
    items: [
      { item: "Lipstick", priority: "must", category: "lip" },
      { item: "Highlighter", priority: "preferred", category: "cheek" },
      { item: "Setting spray", priority: "nice", category: "complexion" },
    ],
  },
  {
    id: "skincare-reset",
    title: "Skincare reset",
    why: "You are starting a simple morning skincare routine.",
    budget: 120,
    items: [
      { item: "Moisturizer", priority: "must", category: "moisturizer" },
      { item: "Sunscreen", priority: "preferred", category: "sunscreen" },
      { item: "Serum", priority: "nice", category: "serum" },
    ],
  },
];

export const getScenario = (id: string) => SCENARIOS.find((s) => s.id === id);
