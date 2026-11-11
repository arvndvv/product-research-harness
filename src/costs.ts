/**
 * What each run costs, and a budget that pauses it.
 *
 * Every model call reports token usage. It's priced here (USD per million
 * tokens: input, cached input, output) and added to the run's running total.
 * Before each call the budget is checked; at the limit the run pauses with
 * everything saved, and you can raise the budget and resume.
 *
 * Prices come from Settings (editable in the app) and fall back to the
 * defaults below. Local models (Ollama, LM Studio) are free. A model with no
 * known price is still counted in tokens and flagged, so nothing is hidden.
 */
import { DEFAULT_PRICES, type ModelPrice, type RunCost, type RunState } from "./shared.ts";
import { loadSettings } from "./settings.ts";

export { DEFAULT_PRICES };

export type Usage = { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } | null };

const isLocal = (baseUrl: string) => /localhost|127\.0\.0\.1/.test(baseUrl);

/** Price for a model, or undefined if unknown. Local servers cost nothing. */
export function priceFor(model: string, baseUrl = ""): ModelPrice | undefined {
  if (isLocal(baseUrl)) return { input: 0, output: 0 };
  return loadSettings().prices?.[model] ?? DEFAULT_PRICES[model];
}

/** USD for one call's usage. Cached input is billed at the cached rate (or full rate if none is set). */
export function costOf(price: ModelPrice, usage: Usage): number {
  const input = usage.prompt_tokens ?? 0;
  const cached = Math.min(input, usage.prompt_tokens_details?.cached_tokens ?? 0);
  const output = usage.completion_tokens ?? 0;
  return ((input - cached) * price.input + cached * (price.cachedInput ?? price.input) + output * price.output) / 1e6;
}

/** Default budget for new runs, in USD (0 = no limit). */
export const defaultRunBudget = () => loadSettings().defaultRunBudgetUsd ?? 1;

/** Add one model call to the run's total. */
export function recordUsage(state: RunState, call: { model: string; baseUrl: string; usage?: Usage }) {
  const c: RunCost = (state.cost ??= { usd: 0, calls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, byPhase: {} });
  const u = call.usage ?? {};
  const price = priceFor(call.model, call.baseUrl);
  const usd = price ? costOf(price, u) : 0;
  c.usd += usd;
  c.calls++;
  c.inputTokens += u.prompt_tokens ?? 0;
  c.cachedTokens += u.prompt_tokens_details?.cached_tokens ?? 0;
  c.outputTokens += u.completion_tokens ?? 0;
  c.byPhase[state.phase] = (c.byPhase[state.phase] ?? 0) + usd;
  if (!price && !(c.unpriced ?? []).includes(call.model)) c.unpriced = [...(c.unpriced ?? []), call.model];
}

/** Has the run reached its budget? (A budget of 0 means no limit.) */
export function overBudget(state: RunState): boolean {
  const budget = state.budgetUsd ?? defaultRunBudget();
  return budget > 0 && (state.cost?.usd ?? 0) >= budget;
}

export const formatUsd = (usd: number) => (usd < 0.01 && usd > 0 ? "<$0.01" : `$${usd.toFixed(2)}`);
