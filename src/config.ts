import { existsSync, readFileSync } from "node:fs";

// Tiny .env loader, so the project has zero runtime dependencies.
function loadDotEnv(path = ".env") {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key] === undefined) process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}
loadDotEnv();

const str = (key: string, fallback = "") => process.env[key] || fallback;
const num = (key: string, fallback: number) => Number(process.env[key] || fallback);

export const config = {
  /**
   * .env DEFAULTS for models and search. On first start these are copied into
   * settings.json, and from then on the app's Settings page is the source of
   * truth (see src/settings.ts). Read effective values via settings.ts.
   *
   * Two model profiles:
   *  - main:  interview + agent loops (discover, research). Many calls, tool use.
   *  - judge: one-shot judgements (shortlist, score, critique, report). Few
   *           calls, where reasoning quality matters most.
   * judge falls back to main when JUDGE_LLM_* isn't set. Typical local setup:
   * main = Ollama on your machine, judge = Mistral API.
   */
  llm: {
    main: {
      baseUrl: str("LLM_BASE_URL", "https://api.mistral.ai/v1").replace(/\/$/, ""),
      apiKey: str("LLM_API_KEY"),
      model: str("LLM_MODEL", "mistral-large-latest"),
    },
    judge: {
      baseUrl: str("JUDGE_LLM_BASE_URL", str("LLM_BASE_URL", "https://api.mistral.ai/v1")).replace(/\/$/, ""),
      apiKey: str("JUDGE_LLM_API_KEY", str("LLM_API_KEY")),
      model: str("JUDGE_LLM_MODEL", str("LLM_MODEL", "mistral-large-latest")),
    },
    timeoutMs: num("LLM_TIMEOUT_MS", 180_000),
  },
  search: {
    provider: str("SEARCH_PROVIDER", "tavily") as "tavily" | "exa" | "brave" | "searxng",
    tavilyKey: str("TAVILY_API_KEY"),
    exaKey: str("EXA_API_KEY"),
    braveKey: str("BRAVE_API_KEY"),
    searxngUrl: str("SEARXNG_URL", "http://localhost:8080").replace(/\/$/, ""),
  },
  // Guardrails. These are the knobs that trade cost/time for thoroughness.
  limits: {
    minLonglist: num("MIN_LONGLIST", 6),
    maxShortlist: num("MAX_SHORTLIST", 5),
    minEvidence: num("MIN_EVIDENCE", 6),
    minDistinctSites: 3,
    maxRounds: num("MAX_ROUNDS", 2),
    maxFetchesPerTask: num("MAX_FETCHES_PER_TASK", 12),
    pageChars: num("PAGE_CHARS", 8000), // lower this for small-context local models
    steps: { discover: 30, research: 25 },
    /** Most questions the interview may ask (corrections at the confirm step don't count). */
    intakeQuestions: num("INTAKE_MAX_QUESTIONS", 6),
    /** Products whose list price is up to this % over budget are still considered, since sale prices are often lower. */
    priceToVerifyPercent: num("PRICE_TO_VERIFY_PERCENT", 30),
  },
  paths: { settings: str("SETTINGS_FILE", "settings.json"), runs: str("RUNS_DIR", "runs"), memory: str("MEMORY_DIR", "memory"), domains: "domains", knowledge: str("KNOWLEDGE_DIR", "knowledge") },
  cache: {
    /**
     * Earlier findings and measurements on a product are carried into new
     * research for this many days (0 = off). They ADD to fresh research; they
     * never replace it. Prices are never reused.
     */
    researchDays: num("CACHE_DAYS", 30),
    /** New findings each product must get in a run, even with earlier evidence. */
    minFreshFindings: num("MIN_FRESH_FINDINGS", 3),
  },
  scoring: {
    /** Share of a criterion's score that comes from measurements when they exist (rest: side-by-side judgement). */
    metricWeight: num("METRIC_WEIGHT", 0.7),
    /** Side-by-side comparisons per criterion, each with the products in a different order; the median is used. */
    judgeSamples: num("JUDGE_SAMPLES", 3),
    /** Products within this many points of the leader are presented as effectively tied. */
    tieMargin: num("TIE_MARGIN", 3),
    /** Two sources "agree" on a measurement when within this fraction of each other. */
    metricAgreement: num("METRIC_AGREEMENT", 0.03),
  },
};
