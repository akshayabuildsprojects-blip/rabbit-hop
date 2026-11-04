# Persona Cart Lab

**Do AI shoppers with different, evidence-based personalities buy differently when everything else is held constant?**

Persona Cart Lab researches how real beauty-shopper archetypes behave, locks that evidence into behavioral profiles, and runs autonomous shopping agents on Meta **Muse Spark** (Meta Model API) side by side. Every agent gets the same catalog, trend feed, mission and budget. Only the persona changes.

Built for the Meta Global AI Developer Hackathon, problem statement **Build for Your World**. Everything in this repository was written during the building period (Oct 27 to Nov 4, 2026).

## Phase 1: Persona Research Engine

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
| Consumer context | Location, disposable income, personal requirements, lifestyle | Experiment tab, per run |
| Shopping mission | Retailer, budget, categories, occasion, objective | Experiment tab, per run |

The persona schema rejects context or mission fields (age, income, budget, location, retailer and so on), so the same locked persona can shop in Singapore or the US, on any budget.

## Experiments

The **Experiment** tab runs selected archetypes in parallel. Locked archetypes use their locked profile. Unresearched ones run from the provisional definition and are labelled that way. Reports cover journeys, baskets, behavior metrics, cart overlap and a blind test where a separate Muse Spark judge identifies each shopper from its cart alone.

Autonomous browser shopping on real retail sites is Phase 2 and not part of this build.

## Run it

Requires Node 22+ and a Meta Model API key from [dev.meta.ai](https://dev.meta.ai).

```bash
npm install
cp .env.example .env     # add MODEL_API_KEY
npm run dev              # API on :3210, UI on :5173
```

Without `MODEL_API_KEY` the app runs in simulation mode: experiments use scripted agents and research is disabled. The UI says so.

### Tests

```bash
npm test
```

All tests use mocked Meta responses, so they never spend API credits. They cover schema validation, invalid persona ids, score bounds, incomplete research, keeping context out of personas, locked-persona protection, reloading locked profiles without API calls, API error handling, and the HTTP routes end to end.

## Project layout

```
server/
  app.ts               Express app: config, experiment stream, persona routes
  agent.ts             Muse Spark tool-calling shopping agent
  personas/
    research.ts        Web research via Responses API + web_search, quality gates, report writer
    generator.ts       Structured profile generation, source verification, validation
    store.ts           Drafts, locking, versions, content hash, integrity checks
    schema.ts          Zod schemas for definitions and profiles
    context.ts         Consumer context and shopping mission schemas
    shopper.ts         Turns a locked profile into an agent brief
    routes.ts          /api/personas endpoints
    metaClient.ts      Meta Model API client (streaming, retries, error mapping)
data/
  persona-definitions/ Five provisional archetypes (editable JSON)
  research-reports/    Markdown reports + raw evidence JSON
  persona-drafts/      Profiles awaiting approval
  personas-locked/     Approved profiles + immutable version archive
web/                   React + Tailwind UI
tests/                 Vitest suites with mocked Meta responses
```

## Data notes

- Catalog products and approximate prices are real Sephora US items entered by hand. Ratings, review summaries, buzz scores and the trend feed are simulated.
- Research reports are produced live by Muse Spark with web search. Review them before locking: web coverage is incomplete and the model can misread sources.

## License

MIT
