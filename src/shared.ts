/**
 * Types shared by the harness, the API server and the web UI.
 * Keep this file free of Node imports so the browser code can use it too.
 */

export type Criterion = { name: string; weight: number; description: string };

export type Requirements = {
  category: string;
  summary: string;
  useCase: string;
  /** flexPercent: how far above max the person accepts (0 = strict). */
  budget: { max: number; currency: string; notes: string; flexPercent?: number };
  region: string;
  mustHaves: string[];
  niceToHaves: string[];
  dealbreakers: string[];
  criteria: Criterion[];
  /** Things the interview assumed without asking (shown to the person to correct). */
  assumptions?: string[];
  userProfile: string[];
};

export type SourceType = "expert_review" | "community" | "spec" | "retailer" | "other";

export type Evidence = {
  id: string;
  candidate: string;
  criterion: string; // a criterion name, or "general"
  finding: string;
  sentiment: "positive" | "negative" | "mixed" | "neutral";
  sourceUrl: string;
  sourceType: SourceType;
  round: number;
  /** Date of the earlier research this finding was reused from. */
  cachedFrom?: string;
  /** Verbatim text from the source page; checked by code when recorded. */
  quote?: string;
};

/**
 * An objective, comparable measurement for a criterion (e.g. a lab camera
 * score, a benchmark, measured battery hours). Saved per category so every
 * run uses the same definitions and the same fixed scale.
 */
export type MetricDef = {
  key: string;
  label: string;
  unit: string;
  higherIsBetter: boolean;
  /** Value of a weak product in this category (scores 0) */
  poor: number;
  /** Value of an excellent product in this category (scores 10) */
  good: number;
  /** Where to find it, ideally the same source for every product */
  sourceHint: string;
  /** The authoritative site (e.g. "dxomark.com"): a value from there counts as confirmed on its own. */
  sourceDomain?: string;
};

export type MetricObservation = {
  id: string;
  candidate: string;
  key: string;
  value: number;
  sourceUrl: string;
  note?: string;
  round: number;
  cachedFrom?: string;
  quote?: string;
};

/** A price seen for a product. Prices are data, so budget checks run in code. */
export type PriceObservation = {
  id: string;
  candidate: string;
  amount: number;
  currency: string;
  /** sale = what you'd pay today; list = MRP / launch price; offer = needs a bank card / coupon */
  kind: "sale" | "list" | "offer";
  seller: string;
  url: string;
  /** retailer/official = seen on a seller's page; article = quoted by a review or listicle (often stale) */
  sourceType: "retailer" | "official" | "article";
  round: number;
  cachedFrom?: string;
  quote?: string;
};

export type Score = {
  criterion: string;
  score: number; // 0-10, final
  confidence: "low" | "medium" | "high";
  evidenceIds: string[];
  rationale: string;
  /** 0-10 from measurements on the fixed scale (computed in code), if any were found */
  metricScore?: number;
  /** 0-10 from the side-by-side comparison by the judge model */
  judgedScore?: number;
  /** The measurements behind metricScore */
  measured?: { key: string; label: string; value: number; unit: string; score: number; confirmed?: boolean }[];
};

export type Candidate = {
  name: string;
  price: string;
  whyConsidered: string;
  source: string;
  status: "longlist" | "shortlist" | "cut";
  cutReason?: string;
  addedInRound: number;
  researched: boolean;
  /** Open questions from the critic that the next research pass must answer. */
  followups: string[];
  notes: string[];
  scores?: Score[];
  total?: number; // 0-100, computed in code
  disqualified?: string;
  /** Must-have / dealbreaker failures judged from evidence (budget is checked separately, in code). */
  ruleFails?: string[];
  /** Research hit its limits without meeting the evidence bar; can't be recommended. */
  incomplete?: string;
  /** Lowest current local price found, computed in code from price observations. */
  bestPrice?: { amount: number; currency: string; seller: string; url: string; verified: boolean };
  /** Needs (re)scoring because evidence changed. */
  dirty: boolean;
  /** Suggested by the person rather than found by discovery. */
  addedByUser?: boolean;
  /** Already got an extra research pass for being thinly researched. */
  toppedUp?: boolean;
};

export type Phase = "intake" | "discover" | "shortlist" | "research" | "score" | "critique" | "report" | "done";

export const PHASE_ORDER: Phase[] = ["intake", "discover", "shortlist", "research", "score", "critique", "report", "done"];

export type RunState = {
  id: string;
  dir: string;
  createdAt: string;
  initialRequest: string;
  phase: Phase;
  round: number;
  requirements?: Requirements;
  candidates: Candidate[];
  evidence: Evidence[];
  prices?: PriceObservation[];
  /** Which measurements each criterion uses (decided once per run, from the category library). */
  metricPlan?: { criterion: string; keys: string[] }[];
  metricDefs?: Record<string, MetricDef>;
  metrics?: MetricObservation[];
  critiqueNotes: string[];
  /** Profile facts saved from this run's interview (shown in the UI). */
  profileUpdates?: string[];
  /** Set after the brief is edited: re-score, then go straight to the report. */
  rescoreOnly?: boolean;
  /** History of brief edits made after the interview. */
  briefEdits?: { t: string; changes: string[] }[];
  reportPath?: string;
};

// --- Profile (long-term memory about the user) -----------------------------

export type ProfileFact = {
  id: string;
  text: string;
  /** Product area this applies to (e.g. "smartphones"); absent = applies to everything. */
  scope?: string;
  source: "intake" | "user";
  updatedAt: string;
};

// --- Live run events (server -> UI) ----------------------------------------

/** A question the harness is waiting on. */
export type PendingQuestion = {
  id: string;
  question: string;
  /** Longer preformatted text shown above the question (e.g. a summary to confirm). */
  details?: string;
  /** Answer guessed from the profile / earlier answers; one click to accept. */
  suggestion?: string;
  /** Quick-reply choices. */
  options?: string[];
  /** e.g. "Question 2 of up to 6" */
  progress?: string;
};

export type RunStatus = "running" | "waiting" | "idle" | "error" | "done";

export type LogLevel = "info" | "dim" | "warn" | "ok";

export type RunEvent =
  | { t: string; type: "log"; level: LogLevel; text: string }
  | { t: string; type: "phase"; phase: Phase; round: number }
  | { t: string; type: "question"; question: PendingQuestion }
  | { t: string; type: "answer"; questionId: string; text: string }
  | { t: string; type: "status"; status: RunStatus; error?: string }
  | { t: string; type: "state" };

/** Event as emitted inside the harness, before the server stamps the time. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type RunEventInput = DistributiveOmit<RunEvent, "t">;

/** Changes the person can make to the brief after seeing results. */
export type BriefEdit = {
  weights?: Record<string, number>;
  budget?: { max: number; flexPercent: number };
  mustHaves?: string[];
  dealbreakers?: string[];
  niceToHaves?: string[];
};

// --- Settings (models and search) ------------------------------------------------

/** An OpenAI-compatible API endpoint: Mistral, OpenAI, OpenRouter, Ollama, LM Studio... */
export type Provider = { id: string; name: string; baseUrl: string; apiKey?: string };
export type ModelChoice = { providerId: string; model: string };
export type SearchProvider = "tavily" | "exa" | "brave" | "searxng";

export type Settings = {
  providers: Provider[];
  /** Interview + research agents (many calls, tool use). */
  main?: ModelChoice;
  /** Shortlist, scoring, critique, report. Absent = same as main. */
  judge?: ModelChoice;
  search: { provider: SearchProvider; tavilyKey?: string; exaKey?: string; braveKey?: string; searxngUrl?: string };
};

/** What the browser sees: keys are never sent back, only whether one is set and its last 4 characters. */
export type SettingsView = {
  providers: (Omit<Provider, "apiKey"> & { keyHint?: string })[];
  main?: ModelChoice;
  judge?: ModelChoice;
  search: { provider: SearchProvider; tavilyKeyHint?: string; exaKeyHint?: string; braveKeyHint?: string; searxngUrl?: string };
};

/** Partial update. For keys: omitted or "" = keep, null = remove, string = set. */
export type SettingsUpdate = {
  providers?: { id?: string; name: string; baseUrl: string; apiKey?: string | null }[];
  main?: ModelChoice;
  judge?: ModelChoice | null;
  search?: { provider?: SearchProvider; tavilyKey?: string | null; exaKey?: string | null; braveKey?: string | null; searxngUrl?: string };
};

/** Setup help shown in the app: what's free, where to get a key, and the steps. */
export type SetupGuide = {
  /** What the free option is, in one or two sentences. Empty if there isn't one. */
  free: string;
  /** Where to create the key (or download the software). */
  link?: { label: string; url: string };
  steps: string[];
  /** Caveats worth knowing before relying on it. */
  note?: string;
};

export type ProviderPreset = { name: string; baseUrl: string; example: string; guide: SetupGuide };
export type SearchOption = { id: SearchProvider; name: string; note: string; guide: SetupGuide };

export type DomainGuide = { name: string; size: number; updatedAt: string };

// --- API shapes --------------------------------------------------------------

export type RunSummary = {
  id: string;
  request: string;
  category?: string;
  phase: Phase;
  round: number;
  status: RunStatus;
  createdAt: string;
  winner?: string;
};

export type RunDetail = {
  state: RunState;
  status: RunStatus;
  error?: string;
  pending?: PendingQuestion;
  report?: string;
  events: RunEvent[];
  tieMargin: number;
};

export type Health = {
  mainModel: string;
  judgeModel: string;
  search: string;
  missing: string[];
  /** Products within this many points of the leader are shown as effectively tied. */
  tieMargin: number;
};
