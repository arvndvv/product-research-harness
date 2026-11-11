# research-harness

A purchase-decision research harness built from scratch, as a learning project.
You describe what you want to buy. It interviews you, researches products on the
web (including Reddit), checks its own work, iterates, and recommends the one product
that fits you best, with every claim linked to a source.

No agent framework and no vendor SDK. It works with any OpenAI-compatible model API
(Mistral by default).

## Setup

Requires Node 20+.

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
```

Then either fill in `.env`, or skip it and set everything up in the app:
**Profile & settings > Models & search** lets you add AI providers (Mistral, OpenAI,
OpenRouter, Ollama, LM Studio or any OpenAI-compatible URL), pick the research and judge
models, choose the web search provider, and test each connection. Changes apply
immediately, with no restart and no code changes. They're stored in `settings.json`
(git-ignored, because it holds your keys); on first start it's created from `.env`.

You need an AI model and a web search service. The settings page shows step-by-step help
for each one (where to sign up, where the key is, what the free plan includes). A fully free
start:

- **AI: Mistral.** Sign up at console.mistral.ai, verify your phone, choose the free
  *Experiment* plan, then create a key under API Keys. No card, no end date, but it's
  rate-limited (about one request a second, so runs are slower), and Mistral may use
  free-plan requests for training. Groq and Google Gemini (AI Studio) also have free tiers
  and are presets in the app; Ollama or LM Studio run models locally for free.
- **Search: Tavily.** Sign up at app.tavily.com; the key (tvly-...) is on the dashboard.
  1,000 free credits a month, no card. Exa (dashboard.exa.ai) is a free alternative with a
  monthly credit. Brave no longer has a free plan (a monthly credit, but a card is
  required). SearXNG is free and unlimited if you run it yourself with Docker.

Free plans change often; the links in the app go to each provider's own page.

**Other AI services** need no code: anything with an OpenAI-compatible
`/chat/completions` API and tool calling works through "Custom" (base URL + key). Use
"Test research model" to check it actually calls tools; research depends on that.

**Other search services** need a few lines of code, because every search API has its own
request and response shape. See [Adding a search service](#adding-a-search-service).

**Profile & settings > Domain guides** lets you write expert notes per product category
(or draft one with AI and correct it). They're saved as `domains/<category>.md`.

### Web app (recommended)

```bash
npm run app        # builds the UI, then serves it at http://localhost:4321
```

- **New research**: describe what you want, in your own words, for any kind of product.
- **Interview**: a few targeted questions (6 at most), only about things that would change
  the result. Quick-reply buttons for common answers; answers it can guess from your profile
  are pre-filled ("Use this" to accept). Assumptions are listed in the summary you confirm.
- **Live progress**: a "working on" panel (current step, product i of n, last update),
  phase tracker, products with scores and prices, every piece of evidence with its source,
  and the raw activity log, all updating as it works.
- **Your profile**: preferences you state in interviews are saved automatically (guesses
  are dropped), general ones and per product area ("For smartphones: OS: Android").
  View, edit, delete or add facts yourself.
- **Stop / Resume**: stop a research at any point (even mid-call); everything found so far
  is kept and **Resume** continues from that step. Also works after a server restart.
- **Adjust brief**: after seeing results, change criteria weights, budget and stretch,
  must-haves, dealbreakers or nice-to-haves. Weights and budget re-rank instantly in code from
  the evidence already collected; must-have/dealbreaker changes re-check each product with the
  model. Only the report is rewritten; nothing new is searched.
- **Cost meter and budget per run**: every model call is priced (Profile & settings > Models & search >
  Cost; built-in Mistral list prices, editable) and the run's cost shows live next to its title, with a
  breakdown per step. A run pauses at its budget (default $1, `0` = no limit) with everything saved;
  raise it and resume from the banner. Costs are kept low by: a cheap research model plus a strong judge,
  showing research only the relevant passages of each page (`PAGE_CHARS`), trimming old tool output
  from the conversation early, and recording several findings or prices in one call.
- **Go back a step**: click Discover or Shortlist (↺) in the step bar of any run, even mid-research.
  Shortlist brings every product found back for review and re-picking, keeping verified findings and
  prices; Discover searches again from scratch, keeping products you added. The interview and brief
  are kept either way, and the old recommendation is saved as `report-before-restart-*.md`.
- **Suggest a product**: on a finished or paused run, add a product you think is worth
  considering (Products tab). It gets the same research, measurements, budget check and
  side-by-side comparison as the others, then the recommendation is updated.
- **History**: every past research stays in the sidebar.

The server binds to `127.0.0.1` only (there's no login), so it's reachable just from your machine.

Try the UI without API keys or cost: `npm run demo` (scripted fake model, separate
`demo-runs/` and `demo-memory/` folders).

UI development with hot reload: run `npm run server` and `npm run web:dev` in two
terminals, then open http://localhost:5173.

### Command line

```bash
npm test                         # no keys needed; uses a fake model
npm start                        # asks what you want to buy
npm start -- "running shoes"     # or pass it directly
npm start -- --resume runs/<run-folder>   # continue an interrupted run
```

CLI and web app share the same runs and profile.

Each run creates `runs/<date>-<topic>/`:

| File | What it is |
|---|---|
| `notes.md` | human-readable view: requirements, candidates, scores, every finding with its source |
| `report.md` | final recommendation |
| `state.json` | the full machine state (what resume reads) |
| `events.jsonl` | progress events shown in the web app (activity log, interview) |
| `log.jsonl` | every model call. Read this when something behaves oddly. |

Your profile lives in `memory/profile.json` (an older `memory/profile.md` is migrated automatically).

## Running with a local model

The harness talks HTTP to any OpenAI-compatible server, so a local model is just a URL.
With [Ollama](https://ollama.com):

```bash
ollama pull qwen2.5:7b        # or any model with tool-calling support
```

```
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=qwen2.5:7b
PAGE_CHARS=4000
```

Small local models are weaker at multi-step tool use and judgement, so there are two
model profiles:

| Profile | Used by | Env vars |
|---|---|---|
| main | intake, discover, research (agent loops, many calls) | `LLM_*` |
| judge | shortlist, score, critique, report (few calls, judgement) | `JUDGE_LLM_*`, falls back to main |

A practical split: local model as main, Mistral API as judge. If the local model keeps
looping or calling tools with bad arguments during research, move main to Mistral too.
`log.jsonl` records which profile and model made each call.

On an 8 GB machine, stick to ~7-8B models at 4-bit quantization, and close other heavy apps.

## Adding a search service

1. In `src/tools/web.ts`, add a branch to `search()` that calls the API and returns
   `{ title, url, snippet }[]` (copy the Exa or Tavily branch; about 15 lines).
2. Add its id to `SearchProvider` and a key field to `Settings.search` / `SettingsView` /
   `SettingsUpdate` in `src/shared.ts`.
3. In `src/settings.ts`: add the key to `searchSettings()`, `settingsView()`,
   `applyUpdate()` and `missingSettings()`, and an entry with setup help to `SEARCH_OPTIONS`.
4. Add the key input in `web/src/components/ModelSettings.tsx` (copy the Exa one).

`npm run typecheck` points at anything you missed. Then use "Test search" in the app.

## How it works

```
intake -> discover -> shortlist -> research -> score -> critique
                                      ^                     |
                                      +----- iterate -------+
                                                            |
                                                 done --> report
```

| Phase | Kind | What it does |
|---|---|---|
| intake | agent (human is a tool) | Interviews you one question at a time, then saves requirements with weighted criteria. You confirm them. |
| discover | agent + web tools | Builds a longlist from expert reviews, Reddit and regional retailers. |
| shortlist | one JSON call | Cuts to at most 5, removing dealbreakers and near-duplicates. |
| research | one agent per product | Records structured evidence with sources, gated on coverage. |
| score | one JSON call per product | Model scores each criterion from evidence only. Code computes totals. |
| critique | one JSON call | Skeptical reviewer: is this decision solid? Can send follow-up questions or add a product that was missed. |
| report | one call | Explains the code-chosen winner, with citations. |

The order of phases is a fixed **workflow** in code. Phases that need open-ended
exploration run an **agent loop** inside. Most real harnesses mix the two like this.

## The design ideas (the things worth learning)

1. **Gated finish** (`src/loop.ts`). Finishing is a tool call that code validates.
   "Only 3 findings, need 6", "no Reddit/owner source yet", "nothing on durability":
   the model is told why and keeps working. This is what fixes "answers fast,
   researches shallow".
2. **Evidence as data** (`src/phases/research.ts`). Findings are structured records
   with a source URL, not prose. Scoring reads the records, not the model's memory.
3. **Code decides, the model judges** (`src/scoring.ts`). The model gives 0-10 per
   criterion at temperature 0. Weighting, ranking and disqualification are done in code.
   The report can't change the winner. This is why it won't flip-flop.
4. **Fresh context per subtask**. Each product is researched in its own conversation,
   so contexts stay small and don't contaminate each other.
5. **Context compaction** (`compactHistory`). Old page dumps are trimmed because the
   facts are already saved.
6. **Iteration with a cap** (`src/phases/critique.ts`). The critic can send it back
   for more research, but `MAX_ROUNDS` guarantees it terminates.
7. **Knowledge in files, not code**. `domains/*.md` is expert guidance per category
   (written by you). `memory/profile.json` keeps facts about you across runs, and the
   interview uses it to pre-fill suggested answers.
8. **Errors are tool results**. A failed fetch goes back to the model as text so it
   tries another source instead of crashing.
9. **Testable without a model** (`test/`). `setChatImpl` swaps in a scripted fake model.

## How decisions stay honest

- **Interview** (`src/phases/intake.ts`): code-controlled. Each turn the model returns what it
  already knows (said / implied / from profile) and at most one question with the reason the
  answer matters. Code rejects questions about known topics, near-duplicates, and anything past
  the question budget.
- **Prices** (`src/pricing.ts`): every price seen is recorded with its source. Prices on a seller's
  own page count as verified; prices in articles are often stale launch prices and only count as
  unverified. Products whose article price is a bit over budget are still researched, since
  previous-generation models are often discounted into budget.
- **Budget is a hard filter in code**: a verified seller price above budget (plus any stretch you
  allowed) rules a product out, including products the critic suggests.
- **Incomplete research can't win**: if a research agent runs out of steps without meeting the
  evidence bar, it's retried once; if it still fails, the product is marked incomplete. An agent
  that keeps asking to finish without doing anything new is stopped after 4 tries.
- **Scores from measurements, not review tone** (`src/metrics.ts`, `src/phases/score.ts`):
  - Before research, each criterion gets 0-3 objective measurements (lab camera score, benchmark,
    measured battery hours, weight...) with a fixed "poor"/"good" scale for the category.
  - Research records them as numbers with sources, from the same source for every product where possible.
  - Code maps each measurement onto 0-10 with the fixed scale. The judge model then compares ALL
    products side by side, one criterion at a time (not each product alone, which drifts with
    review tone). Final = 70% measurement + 30% comparison (`METRIC_WEIGHT`), or comparison only
    when no measurement exists.
  - Confidence is computed by code from measurement coverage and evidence, not self-reported.
  - Rules that keep the numbers honest (each learned from a wrong ranking):
    - only measured outcomes (benchmarks, lab tests, weight), never spec-sheet proxies like TDP, core
      count or clock speed: "lower power" once ranked the slowest processor first;
    - recorded values must fit the measurement's scale, which catches unit mix-ups (kg vs grams);
    - products are only ranked on the same numbers: a measurement missing for any product is left out
      for all of them (and shown as "Not used");
    - measurements of a shared part (a processor benchmark) apply to every product with that part;
    - a single-source measurement counts half until confirmed.
- **The interview accounts for every factor**: each category has a list of decision factors (for
  laptops: display, refresh rate, battery, ports...; created once, kept in `knowledge/<category>/factors.json`).
  Before the brief is accepted, every factor must be asked about, known, part of the criteria, or
  written as an assumption you can correct when confirming. Nothing is assumed silently.
- **Accuracy first, so runs agree because they're right** (not because they copy each other):
  - Every finding, measurement and price carries a verbatim quote that code checks against the
    page actually fetched (`verifyQuote` in `src/tools/web.ts`). Paraphrases and invented details fail.
  - A measurement counts as confirmed only from its authoritative site (e.g. dxomark.com) or when
    two independent sites agree; conflicting values must be resolved, not averaged.
  - Each criterion is compared side by side `JUDGE_SAMPLES` (3) times with the products in a
    different order; the median is used.
  - Products researched much more thinly than the others get one top-up pass.
  - Leaders within `TIE_MARGIN` (3) points are presented as effectively tied, with what decides
    between them for you.
- **Knowledge that accumulates** (`src/library.ts`, files in `knowledge/<category>/`):
  - `metrics.json`: measurement definitions are saved per category and never redefined, so
    every smartphone run uses the same scale.
  - `products/*.json`: earlier findings and measurements on a product (up to `CACHE_DAYS`, 30)
    are carried into new research as dated evidence. Research still runs: each product must get
    `MIN_FRESH_FINDINGS` (3) new findings and a current seller price, and contradictions are
    recorded. Prices are never reused.
  - `seen.json`: products from earlier runs are re-checked by discovery alongside new searching.
  - Delete a category's folder to start fresh.
- **Measure it**: `npm run stability -- runs/<a finished run> --runs 3` re-runs that brief from
  scratch (no earlier evidence) and reports how often the winner and top 3 agree, and how much each
  product's score varies. Use it before and after changing prompts or scoring. It costs N full
  runs; to try it free: `DEMO_MODEL=1 RUNS_DIR=demo-runs KNOWLEDGE_DIR=demo-knowledge npm run stability -- demo-runs/<run>`.
  Faster, for discovery only: `--stage discover` runs just discovery (minutes, not an hour) and
  reports which products every run found and **recall**: how many of the products you expect a
  careful search to find came up. Give the expected list with `--expect "A; B; C"` or a text file
  (one product per line), or keep it in `knowledge/<category>/expected.txt`.
- **Discovery that can't stop early** (`src/phases/discover.ts`). The longlist may only finish when code
  confirms coverage, not just a count:
  - every angle searched: expert reviews, owner threads, retailer/comparison lists in the price range,
    and recent launches (each product records which angle found it);
  - every main brand for the category, region and price range (listed by one model call first) has a
    product on the list or was ruled out with a reason;
  - the search saturated: the last `DISCOVER_SATURATION` (3) searches found nothing new (or the list
    reached `MAX_LONGLIST`, 20).
  After repeated rejections the agent may finish with an explained gap, which the app shows.
  Then **you review the longlist** before anything is cut: remove products, add your own (always
  researched), or ask it to search for more with a hint (up to twice). Set `REVIEW_LONGLIST=0` to skip. The
  Products tab shows how products were found and which brands were checked, and every cut product
  has "Compare this too".

## How the web app is wired

The harness code never talks to a terminal or browser directly. It calls `log()`,
`ask()` and `trace()` from `src/context.ts`, and the front end that started the run
decides what they do:

| | `ask()` | `log()` / events |
|---|---|---|
| CLI (`src/index.ts`) | reads stdin (Enter accepts the suggestion) | prints to the console |
| Server (`src/server.ts`) | becomes a pending question; resolves when the browser POSTs an answer | saved to `events.jsonl` and streamed to the browser (server-sent events) |

`AsyncLocalStorage` carries each run's IO through every `await`, so several runs can
be in flight at once without passing an `io` parameter everywhere. The server is plain
`node:http`; the UI is React + Tailwind in `web/`, sharing types with the server via
`src/shared.ts`.

API (all JSON): `GET/POST /api/runs`, `GET /api/runs/:id`, `GET /api/runs/:id/events` (SSE),
`POST /api/runs/:id/answer`, `POST /api/runs/:id/stop`, `POST /api/runs/:id/resume`,
`PUT /api/runs/:id/brief`, `GET/PUT/POST /api/profile`, `GET /api/health`.

Stopping is cancellation through the run context: the server aborts the run's `AbortSignal`;
the agent loop checks it between steps, model calls and page fetches are aborted mid-flight,
and a pending question is rejected. The run ends with a `StopError`, state is already on disk,
and Resume picks up at the saved phase.

## Suggested reading order

`src/loop.ts` → `src/llm.ts` → `src/runner.ts` → `src/phases/research.ts` →
`src/scoring.ts` + `src/phases/score.ts` → `src/phases/critique.ts` →
`src/context.ts` + `src/server.ts` → `web/src/` → the rest.

## Teaching it a new domain

Guides ship in `domains/*.md` for:

- **Computing**: laptops, tablets, monitors, GPUs, RAM, SSDs, hard drives, NAS, Wi-Fi routers
- **Phones and wearables**: smartphones, smartwatches, earbuds, headphones, power banks
- **Home**: TVs, air conditioners, refrigerators, washing machines, air purifiers
- **Other**: cameras, shoes

A guide is picked when its filename or one of its `Aliases:` appears in the category the interview
produces. The last-mentioned thing wins, so "ssd for laptop" uses `ssds.md` and "laptop ram" uses
`ram.md`; words after "for/with/under" are ignored. Add a guide by copying `domains/laptops.md`,
or use Profile & settings > Domain guides > "Draft with AI" and correct it. No code changes needed.
`npm test` checks every guide parses and its scales point the right way. A guide has up to three jobs:

- **`## Decision factors`** (a bullet list): what the interview must account for. Each factor is
  asked about or shown as an assumption you confirm.
- **`## Measurements`** (a table: `| key | label | unit | better | poor | good | source | part |`):
  trusted, measured outcomes with fixed scales. They're added to the category's measurement library
  (existing keys keep their scale), so every run uses the same benchmarks from the start. `part`
  marks a shared component (e.g. `processor`) so its benchmark applies to every product with it.
  Specs like power rating or core count are refused. Only add a row when reviewers publish the
  same measurement for most products in the category (RTINGS scores, Backblaze failure rates,
  TechPowerUp power draw). Where nothing like that exists (RAM, NAS, routers, fridges), leave the
  table out and say so: products are then compared side by side on evidence instead of a score scale.
- **The rest** (what matters, sources, pitfalls) goes into the discovery, research and judging prompts.

## Exercises (roughly in order)

1. Run it for real and read `log.jsonl`. Find a step where the model did something
   dumb, and fix the prompt or the gate.
2. **"Are you sure?" mode**: after the report, let the user ask questions in the UI.
   Answers must cite evidence. The recommendation changes only if new research changes a score.
3. **Evals**: save 3-5 past decisions you're confident about (requirements + the
   right answer). Run the harness on them after every prompt change and track whether
   it still picks right. This is the most important habit in harness work.
4. Research candidates in parallel (`Promise.all` with a concurrency limit).
5. Give the critic its own `web_search` so it can verify that a "better" product exists
   before proposing it.
6. Cost tracking: sum `usage` from `log.jsonl` per phase.
7. Better page extraction: `@mozilla/readability` + `jsdom` instead of `util/html.ts`.
8. Swap in a JSON-schema-enforced output mode for local models (Ollama supports
   schema-constrained output), replacing JSON mode + retries in `chatJSON`.

## Limits to know

- Some sites block automated fetches; the agent is told to try other sources.
  Reddit is fetched through its public `.json` endpoints, which can be rate-limited.
- Scores are only as good as the evidence found. Check the `?` (low-confidence) cells
  in the scoreboard before trusting a close call.
