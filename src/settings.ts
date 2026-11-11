/**
 * Models and search settings, editable in the app (Profile > Models & search).
 *
 * Stored in settings.json (git-ignored; it holds API keys). On first start it
 * is created from .env, so an existing .env setup keeps working. After that the
 * file is the source of truth, and changes apply to the next model call: no
 * code changes, no restart.
 *
 * The harness reads models through llmTarget() and search through
 * searchSettings(), never from config directly.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "./config.ts";
import { DEFAULT_PRICES, type ProviderPreset, type SearchOption, type Settings, type SettingsUpdate, type SettingsView } from "./shared.ts";

/**
 * Presets offered in the UI, with setup help. All speak the OpenAI
 * /chat/completions format; any other service that does (and supports tool
 * calling) works through "Custom" with no code changes.
 *
 * Free tiers change often. Keep these notes free of exact numbers that go
 * stale, and point at the provider's own page for current limits.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    example: "mistral-large-latest",
    guide: {
      free: "Free Experiment plan: no card needed, no end date, but rate-limited (roughly one request a second), so research runs slower.",
      link: { label: "console.mistral.ai", url: "https://console.mistral.ai/" },
      steps: [
        "Sign up at console.mistral.ai and verify your phone number (one free plan per number).",
        "Open Subscription (Admin Console > Subscription > Mistral AI Studio) and choose \"Experiment for free\".",
        "Go to API Keys, click \"Create new key\" and copy it. It's shown only once.",
        "Paste it below. Good models: mistral-large-latest for judging, mistral-medium-latest or mistral-small-latest for research.",
      ],
      note: "On the free plan, Mistral may use your requests to train its models. Don't put anything private in a research brief.",
    },
  },
  {
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    example: "llama-3.3-70b-versatile",
    guide: {
      free: "Free tier with no card: open models (Llama, Qwen, GPT-OSS), very fast, with per-minute and daily request limits.",
      link: { label: "console.groq.com/keys", url: "https://console.groq.com/keys" },
      steps: ["Sign up at console.groq.com.", "Open API Keys and click \"Create API Key\". Copy it (starts with gsk_).", "Paste it below and use \"Load models\" to pick one that supports tool calling."],
      note: "Daily limits can run out during a long research; it's a good fit as the research model with a stronger judge.",
    },
  },
  {
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    example: "gemini-2.5-flash",
    guide: {
      free: "Free tier in Google AI Studio with no billing set up, limited by requests per minute and per day.",
      link: { label: "aistudio.google.com/apikey", url: "https://aistudio.google.com/apikey" },
      steps: ["Sign in at aistudio.google.com/apikey with a Google account.", "Click \"Create API key\" and copy it.", "Paste it below. This uses Gemini's OpenAI-compatible address, already filled in."],
      note: "Free-tier prompts may be used to improve Google's products. The daily request limit is low for a full research run; it works better as the judge model.",
    },
  },
  {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    example: "provider/model-name",
    guide: {
      free: "One key for hundreds of models. Some models are free (their names end in :free), with daily limits; the rest are pay-as-you-go.",
      link: { label: "openrouter.ai/keys", url: "https://openrouter.ai/keys" },
      steps: ["Sign up at openrouter.ai.", "Open Keys and create a key.", "Paste it below and use \"Load models\" to choose."],
    },
  },
  {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    example: "gpt-4.1-mini",
    guide: {
      free: "",
      link: { label: "platform.openai.com/api-keys", url: "https://platform.openai.com/api-keys" },
      steps: ["Sign in at platform.openai.com and add billing credit.", "Open API keys and create a secret key.", "Paste it below."],
      note: "Paid only.",
    },
  },
  {
    name: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    example: "qwen2.5:7b",
    guide: {
      free: "Runs models on your own computer: free and private, but slower, and small models research less reliably.",
      link: { label: "ollama.com/download", url: "https://ollama.com/download" },
      steps: ["Install Ollama and start it.", "Pull a model that supports tool calling, e.g. run: ollama pull qwen2.5:7b", "No key needed. Choose the model below."],
      note: "Raise LLM_TIMEOUT_MS in .env if calls time out. Pair it with a hosted judge model for better decisions.",
    },
  },
  {
    name: "LM Studio (local)",
    baseUrl: "http://localhost:1234/v1",
    example: "loaded model name",
    guide: {
      free: "Runs models on your own computer: free and private, but slower.",
      link: { label: "lmstudio.ai", url: "https://lmstudio.ai/" },
      steps: ["Install LM Studio and download a model that supports tool calling.", "Start the local server (Developer tab).", "No key needed. Choose the loaded model below."],
    },
  },
];

/** Web search options, with setup help. Adding another: see "Adding a search service" in the README. */
export const SEARCH_OPTIONS: SearchOption[] = [
  {
    id: "tavily",
    name: "Tavily",
    note: "Built for AI agents. Free monthly credits, no card.",
    guide: {
      free: "Free plan: 1,000 credits a month with no card (a basic search costs 1 credit), enough for several research runs.",
      link: { label: "app.tavily.com", url: "https://app.tavily.com/" },
      steps: ["Sign up at app.tavily.com (email, Google or GitHub).", "Your key (starts with tvly-) is on the dashboard. Copy it.", "Paste it below, save, then press Test search."],
    },
  },
  {
    id: "exa",
    name: "Exa",
    note: "AI search engine. Free credit every month, no card.",
    guide: {
      free: "Free plan: sign-up credit plus a monthly free credit, no payment method. Requests stop when the credit runs out, so it can't charge you.",
      link: { label: "dashboard.exa.ai/api-keys", url: "https://dashboard.exa.ai/api-keys" },
      steps: ["Sign up at exa.ai.", "Open API Keys in the dashboard and copy your key.", "Paste it below, save, then press Test search."],
    },
  },
  {
    id: "brave",
    name: "Brave Search",
    note: "Independent index. Monthly credit; card required.",
    guide: {
      free: "No free plan any more: each month includes a $5 credit (about 1,000 searches), but you must add a card and usage beyond that is billed.",
      link: { label: "api-dashboard.search.brave.com", url: "https://api-dashboard.search.brave.com/" },
      steps: ["Sign up at api-dashboard.search.brave.com and add a card.", "Subscribe to the Search plan.", "Create an API key, paste it below, save, then press Test search."],
      note: "Set a spending limit in Brave's dashboard if one is offered.",
    },
  },
  {
    id: "searxng",
    name: "SearXNG",
    note: "Self-hosted, free and unlimited. Needs Docker.",
    guide: {
      free: "Free and unlimited: a search engine you run yourself that queries Google, Bing, DuckDuckGo and others.",
      link: { label: "docs.searxng.org", url: "https://docs.searxng.org/admin/installation-docker.html" },
      steps: [
        "Run it with Docker: docker run -d -p 8080:8080 -v ./searxng:/etc/searxng searxng/searxng",
        "In searxng/settings.yml, under search: formats:, add json next to html, then restart the container.",
        "Enter http://localhost:8080 below, save, then press Test search.",
      ],
      note: "Results can be patchier than paid APIs when the upstream engines rate-limit it.",
    },
  },
];

let cache: Settings | null = null;

/** Build initial settings from .env (used once, when settings.json doesn't exist). */
function settingsFromEnv(): Settings {
  const { main, judge } = config.llm;
  const nameFor = (url: string) => PROVIDER_PRESETS.find((p) => p.baseUrl === url)?.name ?? new URL(url).host;
  const providers = [{ id: randomUUID(), name: `${nameFor(main.baseUrl)} (from .env)`, baseUrl: main.baseUrl, apiKey: main.apiKey || undefined }];
  let judgeProvider = providers[0].id;
  if (judge.baseUrl !== main.baseUrl || judge.apiKey !== main.apiKey) {
    providers.push({ id: randomUUID(), name: `${nameFor(judge.baseUrl)} (judge, from .env)`, baseUrl: judge.baseUrl, apiKey: judge.apiKey || undefined });
    judgeProvider = providers[1].id;
  }
  const s = config.search;
  return {
    providers,
    main: { providerId: providers[0].id, model: main.model },
    judge: judgeProvider !== providers[0].id || judge.model !== main.model ? { providerId: judgeProvider, model: judge.model } : undefined,
    search: { provider: s.provider, tavilyKey: s.tavilyKey || undefined, exaKey: s.exaKey || undefined, braveKey: s.braveKey || undefined, searxngUrl: s.searxngUrl },
  };
}

export function loadSettings(): Settings {
  if (cache) return cache;
  const file = config.paths.settings;
  if (existsSync(file)) {
    cache = JSON.parse(readFileSync(file, "utf8")) as Settings;
  } else {
    cache = settingsFromEnv();
    saveSettings(cache);
  }
  return cache;
}

function saveSettings(s: Settings) {
  cache = s;
  writeFileSync(config.paths.settings, JSON.stringify(s, null, 2));
}

/** For tests: forget the in-memory copy. */
export function resetSettingsCache() {
  cache = null;
}

/** Effective model endpoint for a profile. */
export function llmTarget(profile: "main" | "judge") {
  const s = loadSettings();
  const choice = (profile === "judge" && s.judge) || s.main;
  const provider = s.providers.find((p) => p.id === choice?.providerId);
  return {
    baseUrl: (provider?.baseUrl ?? "").replace(/\/$/, ""),
    apiKey: provider?.apiKey ?? "",
    model: choice?.model ?? "",
    providerName: provider?.name ?? "(none)",
  };
}

export function searchSettings() {
  const s = loadSettings().search;
  return {
    provider: s.provider,
    tavilyKey: s.tavilyKey ?? "",
    exaKey: s.exaKey ?? "",
    braveKey: s.braveKey ?? "",
    searxngUrl: (s.searxngUrl || "http://localhost:8080").replace(/\/$/, ""),
  };
}

const hint = (key?: string) => (key ? `••••${key.slice(-4)}` : undefined);

/** Safe view for the browser: no keys, only hints. */
export function settingsView(): SettingsView {
  const s = loadSettings();
  return {
    providers: s.providers.map(({ apiKey, ...p }) => ({ ...p, keyHint: hint(apiKey) })),
    main: s.main,
    judge: s.judge,
    search: { provider: s.search.provider, tavilyKeyHint: hint(s.search.tavilyKey), exaKeyHint: hint(s.search.exaKey), braveKeyHint: hint(s.search.braveKey), searxngUrl: s.search.searxngUrl },
    prices: s.prices ?? {},
    defaultPrices: DEFAULT_PRICES,
    defaultRunBudgetUsd: s.defaultRunBudgetUsd ?? 1,
  };
}

/** Key update rule: undefined or "" keeps the old key, null removes it, a string sets it. */
const nextKey = (current: string | undefined, update: string | null | undefined) =>
  update === null ? undefined : update === undefined || update === "" ? current : update.trim();

export function validateUpdate(u: SettingsUpdate, s: Settings): string | null {
  if (u.defaultRunBudgetUsd !== undefined && !(Number.isFinite(u.defaultRunBudgetUsd) && u.defaultRunBudgetUsd >= 0)) return "the run budget must be 0 (no limit) or more";
  for (const [model, p] of Object.entries(u.prices ?? {})) {
    if (!p) continue;
    const ok = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
    if (!ok(p.input) || !ok(p.output) || (p.cachedInput !== undefined && !ok(p.cachedInput))) return `prices for ${model} must be numbers of 0 or more (USD per million tokens)`;
  }
  if (u.search?.provider && !SEARCH_OPTIONS.some((o) => o.id === u.search!.provider)) return `unknown search service: ${u.search.provider}`;
  const providers = u.providers ?? s.providers;
  for (const p of providers) {
    if (!p.name?.trim()) return "every provider needs a name";
    try {
      const url = new URL(p.baseUrl);
      if (!/^https?:$/.test(url.protocol)) return `base URL for ${p.name} must start with http:// or https://`;
    } catch {
      return `base URL for ${p.name} isn't a valid URL`;
    }
  }
  const ids = new Set(providers.map((p) => p.id).filter(Boolean));
  for (const [label, choice] of [["research model", u.main], ["judge model", u.judge]] as const) {
    if (!choice) continue;
    if (!choice.model?.trim()) return `choose a model name for the ${label}`;
    if (u.providers && !ids.has(choice.providerId)) return `the ${label} uses a provider that doesn't exist`;
    if (!u.providers && !s.providers.some((p) => p.id === choice.providerId)) return `the ${label} uses a provider that doesn't exist`;
  }
  return null;
}

export function applyUpdate(u: SettingsUpdate): Settings {
  const s = structuredClone(loadSettings());
  if (u.providers) {
    s.providers = u.providers.map((p) => {
      const old = p.id ? s.providers.find((x) => x.id === p.id) : undefined;
      return { id: old?.id ?? randomUUID(), name: p.name.trim(), baseUrl: p.baseUrl.trim().replace(/\/$/, ""), apiKey: nextKey(old?.apiKey, p.apiKey) };
    });
    // Choices pointing at a removed provider are dropped.
    if (s.main && !s.providers.some((p) => p.id === s.main!.providerId)) s.main = undefined;
    if (s.judge && !s.providers.some((p) => p.id === s.judge!.providerId)) s.judge = undefined;
  }
  if (u.main) s.main = { providerId: u.main.providerId, model: u.main.model.trim() };
  if (u.judge !== undefined) s.judge = u.judge ? { providerId: u.judge.providerId, model: u.judge.model.trim() } : undefined;
  if (u.prices) {
    const next: Record<string, { input: number; cachedInput?: number; output: number }> = {};
    for (const [model, p] of Object.entries(u.prices)) if (p && model.trim()) next[model.trim()] = p;
    s.prices = next;
  }
  if (u.defaultRunBudgetUsd !== undefined) s.defaultRunBudgetUsd = u.defaultRunBudgetUsd;
  if (u.search) {
    s.search = {
      provider: u.search.provider ?? s.search.provider,
      tavilyKey: nextKey(s.search.tavilyKey, u.search.tavilyKey),
      exaKey: nextKey(s.search.exaKey, u.search.exaKey),
      braveKey: nextKey(s.search.braveKey, u.search.braveKey),
      searxngUrl: u.search.searxngUrl?.trim() || s.search.searxngUrl,
    };
  }
  saveSettings(s);
  return s;
}

/** What's missing before research can run. */
export function missingSettings(): string[] {
  const missing: string[] = [];
  const main = llmTarget("main");
  if (!main.baseUrl || !main.model) missing.push("a research model");
  else if (!main.apiKey && !/localhost|127\.0\.0\.1/.test(main.baseUrl)) missing.push(`an API key for ${main.providerName}`);
  const judge = llmTarget("judge");
  if (judge.baseUrl !== main.baseUrl && !judge.apiKey && !/localhost|127\.0\.0\.1/.test(judge.baseUrl)) missing.push(`an API key for ${judge.providerName}`);
  const s = searchSettings();
  if (s.provider === "tavily" && !s.tavilyKey) missing.push("a Tavily API key");
  if (s.provider === "exa" && !s.exaKey) missing.push("an Exa API key");
  if (s.provider === "brave" && !s.braveKey) missing.push("a Brave Search API key");
  return missing;
}
