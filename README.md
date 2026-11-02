# Persona Cart Lab

**Do AI shoppers with different personalities buy differently when everything else is held constant?**

Persona Cart Lab runs four autonomous shopping agents on Meta **Muse Spark** (via Meta Model API) side by side. Every agent gets the same shopping goal, the same budget, the same 44-product beauty catalog and the same social trend feed. Only the persona changes. The app streams each agent's journey live, prints its basket as a receipt, then measures how far apart the baskets are, including a blind test where a separate Muse Spark judge must identify each shopper from its cart alone.

Built for the Meta Global AI Developer Hackathon, track problem statement: **Build for Your World**.

## What was built during the hackathon

Everything in this repository was written during the building period (Oct 27 to Nov 4, 2026). There is no pre-existing codebase.

- Multi-agent orchestration on Muse Spark with native function calling (`server/agent.ts`)
- Seven shopping tools with a server-enforced hard budget (`server/tools.ts`)
- Blind persona-identification judge and persona-fidelity scoring on Muse Spark (`server/judge.ts`)
- Curated catalog, simulated trend feed and four persona definitions (`server/data/`)
- Live streaming UI: agent journeys, receipts, and comparison metrics (`web/src/`)

## How it works

1. **Persona assignment.** Each agent receives a system prompt describing its personality, priorities and decision style: Trend Chaser, Beauty Researcher, Dupe Hunter, Luxury Curator.
2. **Autonomous shopping.** Agents run in parallel. Each one decides which tools to call and in what order:
   - `view_trend_feed`: posts from TikTok, Instagram, YouTube and Reddit with the products they mention
   - `search_catalog`: filter by text, category, max price; sort by price, rating or buzz
   - `get_product_details`: ingredients, claims, review pros and cons, social mentions
   - `find_alternatives`: known dupes and cheaper options in the same category
   - `add_to_basket` / `remove_from_basket`: with a one-sentence reason and the main influence (trend, reviews, ingredients, price, prestige, dupe). The server rejects anything over budget.
   - `finalize_basket`: checkout with a short summary
3. **Live view.** The server streams every thought and tool call as NDJSON; the UI renders each agent's lane and receipt as it happens.
4. **Evaluation.**
   - **Blind identification:** a separate Muse Spark call sees only the products in each shuffled, unlabeled basket and assigns each to a persona. Accuracy measures behavioral differentiation.
   - **Persona fidelity:** Muse Spark scores each agent 0 to 10 against its persona using purchases, reasons and research behavior.
   - **Deterministic metrics:** spend, basket size, average price per item, share of items mentioned in the trend feed, products inspected, alternatives checked, declared influence mix, and pairwise basket overlap (Jaccard).
   - **Download run data** exports the full run as JSON for repeat-run analysis.

## Run it

Requires Node 22+ and a Meta Model API key from [dev.meta.ai](https://dev.meta.ai).

```bash
npm install
cp .env.example .env      # add MODEL_API_KEY
export $(cat .env | xargs)
npm run dev               # API on :3000, UI on :5173
```

Production: `npm run build && npm start` (serves UI and API on `PORT`, default 3000).

Without `MODEL_API_KEY` the app runs in **simulation mode**: scripted agents stand in so the UI can be developed offline, and the page says so clearly. All real results come from Muse Spark.

### Deploy on Replit

1. Import this GitHub repo into Replit.
2. Add a Secret named `MODEL_API_KEY`.
3. Click Run, or Deploy for a public URL. `.replit` already has the build and run commands.

## Model API details

Meta Model API is OpenAI-compatible, so the server uses the `openai` npm client pointed at `https://api.meta.ai/v1` with `MODEL_API_KEY`. The default model is `muse-spark-1.1`; set `MODEL_ID` to use another Muse Spark version.

## Data notes

- Product names, brands and approximate prices are real Sephora US items entered by hand. No data was scraped. Links go to Sephora search results.
- Ratings, review counts, review summaries, buzz scores and the trend feed are **simulated** and creator handles are fictional, so every agent sees identical, controlled inputs.
- This is a behavioral experiment. Using it as synthetic market research would require validation against real shopper behavior.

## Project layout

```
server/
  index.ts        Express API, streaming experiment endpoint, static UI
  agent.ts        Muse Spark tool-calling loop per persona
  tools.ts        Tool schemas and the shopping session (budget enforcement)
  judge.ts        Blind identification + fidelity scoring
  simulation.ts   Offline scripted agents (no API key)
  llm.ts          Meta Model API client
  data/           catalog, trends, personas
shared/types.ts   Types shared by server and UI
web/              Vite + React + Tailwind UI
```

## Roadmap

- Repeat runs per persona to measure shopping consistency
- User-defined personas
- Image input of creator posts using Muse Spark vision
- Authorized retailer catalog integration

## License

MIT
