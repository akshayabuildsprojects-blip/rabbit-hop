# Rabbit Hop

**Can an AI agent shop like a specific kind of person, and can we prove it?**

Rabbit Hop sends AI shoppers with researched, locked personas to shop live beauty stores (Sephora and Olive Young US) through Meta **Muse Spark** computer use, then measures how faithfully each one behaves like the person it represents.

I'm Akshaya, an Executive MBA student who loves skincare and makeup. Across customer discovery work in different domains, I have always wondered whether agentic infrastructure could automate part of it. Rabbit Hop is my attempt to find out, starting with the beauty aisle.

Built for the Meta Global AI Developer Hackathon (Indie developer track), problem statement **Build for Your World**. Everything here was written during the building period (Oct 27 to Nov 4, 2026).

## The problem

- Customer discovery is slow and manual, and surveys capture what people say they do, not what they do on a real store.
- Generic AI shopping agents optimize for finding the best product fast, not for behaving like a specific shopper.
- Agent behavior varies run to run, so one run cannot be trusted.

Rabbit Hop treats this as an evaluation problem: success is **persona fidelity**, not task completion. The shopper is told its steps and basket are judged on how faithfully they match its persona, not on speed, not on finding the objectively best product, and not on spending the whole budget.

## How it works

```
Locked persona ──► Prior data (optional) ──► Plan as the persona ──► Shop a live store ──► Basket with reasons ──► Blind judge + consistency across repeats
```

1. **Locked persona.** Five archetypes are researched with Muse Spark and web search, reviewed, versioned and locked (see below).
2. **Scenario.** A curated mission: a budget and a prioritized shopping list (for example, New vanity: $150, foundation must-have, blush preferred, mascara nice to have).
3. **Prior data (optional).** Each shopper can bring a 100-purchase shopping history. Muse plans with the full history and keeps a short summary in mind while shopping. The judge never sees it.
4. **Plan.** Before touching the page, Muse makes a plan as the persona through a `make_plan` function tool: where to start (search box, category menus, best sellers, new arrivals, sale), how to search (generic then filter, by attributes, or a brand it already knows), what evidence it needs per list item, and how many options to compare. It then shops by the plan and says why when it deviates.
5. **Shop.** Muse Spark computer use drives a real Chrome window on the live store: searching, sorting, filtering, scrolling and opening products. Every purchase, comparison and rejection is recorded through function tools with a reason, a decision driver and where the information came from.
6. **Evaluate.** A blind Muse Spark judge guesses which persona made which basket, from purchases alone and from purchases plus behavior. Repeated runs under identical conditions are compared through behavior signatures: planned start and search style, actual entry point, sorting, filters, main driver, price tier, list items bought, products viewed and brands.

## Meta models used

All model calls use **Muse Spark (`muse-spark-1.3`)** through the Meta Model API (`https://api.meta.ai/v1`, OpenAI-compatible):

| Where | API features |
|---|---|
| Persona research | Responses API with `web_search`, cited sources, structured output |
| Planning | Responses API with a function tool and `tool_choice: required` |
| Live shopping | Responses API `computer` tool (batched click, type, scroll, keypress actions answered with screenshots), function tools, `previous_response_id` chaining, safety-check acknowledgment |
| Evaluation | Blind judge and fidelity scoring |

## 1. Persona research

Five archetypes start from explicit baseline behavioral definitions in `data/persona-definitions/` (motivation, characteristics and a typical shopping journey). They are hypotheses, not validated findings, and contain no income, geography or budget.

| id | Archetype | Baseline motivation | Baseline journey |
|---|---|---|---|
| `trend-driven` | Trend-Driven Beauty Shopper | Staying current with beauty trends and discovering new products | Social discovery → Influencer validation → Product research → Purchase |
| `sensitive-skin` | Practical Sensitive-Skin Shopper | Product suitability, reliability, and minimizing adverse reactions | Identify need → Ingredient research → Suitability assessment → Purchase |
| `time-constrained` | Time-Constrained Professional | Convenience, reliable performance, and time efficiency | Identify need → Evaluate convenience/performance → Select reliable product → Purchase |
| `price-sensitive` | Price-Sensitive Value Shopper | Maximum practical utility at minimum cost | Identify need → Compare products/prices → Research alternatives → Purchase best-value option |
| `luxury` | Luxury Beauty Shopper | Premium quality, exclusivity, prestige, and elevated product experiences | Curated discovery → Brand/product evaluation → Compare premium alternatives → Purchase |

For each one, in the **Personas** tab:

1. **Research with Meta AI.** One Responses API call on `muse-spark-1.3` with the built-in `web_search` tool investigates discovery channels and social influence, shopping journeys, trust in creators and reviews, evaluation habits, price sensitivity and brand loyalty, triggers and rejection criteria, research depth, novelty seeking and impulse buying. Every point is cited and marked **[Evidence]** or **[Assumption]**. Each baseline hypothesis (H1, H2, ...) gets a verdict: supported, refined, challenged or insufficient evidence. The other archetypes are included for contrast so the five stay distinct. Meta's `url_citation` annotations are preserved as returned.
2. **Quality gates.** Research is rejected (no draft is created) if the model did not search, cited fewer than 4 sources, skipped a required section, or did not evaluate the baseline hypotheses.
3. **Report saved.** A Markdown report with citations plus the raw evidence JSON go to `data/research-reports/<id>/`.
4. **Structured profile.** A second call with structured output (`text.format` JSON schema) turns the report into a profile: identity and motivation, 10 behavioral parameters (0 to 1), discovery channels, trusted sources, evaluation criteria, purchase and rejection triggers, comparison strategy, shopping sequence, explicit decision rules, and evidence (baseline hypothesis verdicts, sources, summary, assumptions, limitations). It starts from the baseline and changes it only where the research says so. Source URLs the model proposes that were not cited during research are removed.
5. **Validated draft.** Zod validates the profile and it is saved to `data/persona-drafts/<id>.json` with status `draft`.
6. **Review and edit.** Read the findings and sources; adjust parameters, description, lists and comparison strategy. Evidence, identity and metadata are not editable.
7. **Approve and lock.** Explicit approval writes `data/personas-locked/<id>.json` plus an archive copy that is never overwritten, with version number, approval timestamp and a SHA-256 content hash.

Behavioral parameters are **simulation settings informed by qualitative research, not scientifically validated measurements**. Every profile carries that label.

### Locked means locked

- A locked persona is never regenerated. Changes go through a new version (copy and edit, or re-research), and the locked version stays in use until the new one is approved.
- Shopping runs load personas on the server, read-only. The hash is checked on every load, so edits made to the file after approval are refused.
- Nothing an agent learns during a session is written back to the persona.

### Three layers

| Layer | Holds | Where it lives |
|---|---|---|
| Core persona | Shopping psychology, priorities, decision rules | Locked profile |
| Consumer context | Location, disposable income, personal requirements, lifestyle | Set per run |
| Shopping mission | Retailer, budget, shopping list, objective | Scenario and store, per simulation |

The persona schema rejects context or mission fields (age, income, budget, location, retailer and so on), so the same locked persona can shop in Singapore or the US, on any budget.

## 2. Simulations

The **Simulation** page has six steps: choose shoppers (locked only), choose a scenario, prior data, where they shop, a limit per shopper (steps, default 30, or minutes, 1 to 20), and run.

- Shoppers run one after another in a visible Chrome window on your computer. No sign-in, no checkout, no personal details.
- A simulation is one fixed setup. "Run again with the same setup" adds a repeat under exactly the same conditions; changing anything starts a new simulation. Repeats are manual, never automatic.
- **Results** groups everything by simulation: an overview, each persona and store combination with its repeats side by side, its plan, its journey and consistency, a blind test per store and run, and an across-stores view. Download and delete apply to the whole simulation.

### Prior data

`data/prior-data/` holds one shopping history per archetype: 100 purchases with date, store, brand, product, category, price, brand origin, tier, decision driver, discovery source, rating, repurchase, return and a note. Origins in scope: US, UK, French, K-beauty, J-beauty, Thai and Indian.

**These histories are synthetic and illustrative, not real customer data.** Each is written from its persona's definition (for example, Luxury repurchases signature items and returns expensive products that disappoint; Sensitive-Skin buys mostly fragrance-free barrier care and returns products that sting). You can attach your own CSV in the same format instead. The history is copied into the simulation's folder so repeats use exactly the same file.

## 3. The harness: engineering problems solved

- **Retailer refusals.** Sephora refuses in-page product navigation for automated sessions. Products open in new tabs with a full page load, nothing can be bought unless its product page was opened, and if the store refuses product pages the shopper must scroll and read the results before deciding from tiles. A final decide step guarantees a decision when browsing ends. No bot-detection evasion, no CAPTCHA solving, no use of a personal browser.
- **Shortcuts.** Early agents typed product URLs and searched "[brand] blush". Typed web addresses are blocked, new tabs only open product links the shopper has actually seen on screen, and the planning step makes search style a persona decision.
- **Meta API constraints.** Input images are accepted only in the first request of a chain, so later screenshots travel as `computer_call_output`. Requests without the computer tool cannot carry `computer_call_output`, so the final decide step is a stateless text request.
- **Safety checks.** Every computer action can carry a pending safety check. A review policy acknowledges ordinary browsing on the allowed store and stops on typed URLs, personal data, sign-in, basket and checkout pages.
- **Pop-ups.** An init script closes sign-in modals and stray backdrops; cookie banners are declined.
- **Reproducibility.** Fresh browser context per run, fixed viewport (1280 x 800), locale and timezone, `temperature: 0` when accepted, versioned prompts (`browse-v10`) and personas, and saved run settings including the prior data's SHA-256.

## Run it

Requires Node 22+, Google Chrome, and a Meta Model API key from [dev.meta.ai](https://dev.meta.ai).

```bash
npm install
cp .env.example .env     # add MODEL_API_KEY
npm run dev              # API on :3210, UI on :5173
```

Live store runs open Chrome on the machine running the server. Without `MODEL_API_KEY` the app runs in simulation mode with scripted agents and research disabled.

Run results (including screenshots) are saved to `data/runs/`, which is git-ignored.

### Tests

```bash
npm test
```

65 tests with mocked Meta responses, so they never spend API credits: persona schemas and locking, the computer-use loop on a local test store, safety-check review, new-tab opening and no buying without looking, the planning step, prior data parsing and prompts, routes, and the judge.

## Project layout

```
server/
  app.ts               Express app: config, simulation endpoints, run stream, prior data
  browser/shopAgent.ts Muse Spark computer-use shopper: plan, browse, decide, safety review
  browser/check.ts     Chrome launch and store checks
  judge.ts             Blind tests and fidelity scoring
  simulations.ts       Grouping runs into simulations, consistency, delete
  personas/            Research, profile generation, locking and versions
shared/
  scenarios.ts         Curated missions
  consistency.ts       Behavior signatures and consistency across repeats
  priorData.ts         Prior data CSV parsing, summary and prompt text
data/
  persona-definitions/ Five archetype definitions
  research-reports/    Research reports and evidence
  prior-data/          Synthetic archetype shopping histories (CSV)
web/                   React + Tailwind UI
tests/                 Vitest suites with mocked Meta responses
```

## Data notes

- Prior data histories are synthetic. Brands and products are real; prices are approximate.
- Research reports are produced live by Muse Spark with web search. Review them before locking: web coverage is incomplete and the model can misread sources.
- Persona research covered Sephora and Ulta. On Olive Young US, shoppers use their core behavior without store-specific findings.

## Next steps

- Identify the shopper, assign a persona, and replace the archetype history with the shopper's own purchase history (same CSV format).
- More stores, with store-specific persona research.
- More repeats per setup for statistically meaningful consistency, and per-store fidelity scores.
- A hosted version, which needs retailers that allow automated sessions.
- Beyond beauty: the same persona, plan, shop and judge loop applies to customer discovery in other domains.

## License

MIT
