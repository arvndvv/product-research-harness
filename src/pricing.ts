/**
 * Prices are data, and budget is a hard filter enforced in code.
 *
 * Why: prices quoted in articles and search snippets are often launch/list
 * prices from months ago (a phone launched at ₹60k may sell for ₹45k today).
 * So every price the agent sees is recorded with where it came from, and code
 * decides what counts:
 *   - verified   = seen on a seller's page in the person's currency
 *   - unverified = only quoted by articles (may be stale)
 * Bank-card / coupon offers are shown but never used for the budget check.
 */
import type { Candidate, PriceObservation, Requirements, RunState } from "./shared.ts";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function pricesFor(state: RunState, name: string): PriceObservation[] {
  return (state.prices ?? []).filter((p) => norm(p.candidate) === norm(name));
}

/** Upper budget limit including the person's flexibility, or Infinity if no budget. */
export function budgetLimit(req: Requirements): number {
  if (!req.budget.max || req.budget.max <= 0) return Infinity;
  return Math.round(req.budget.max * (1 + (req.budget.flexPercent ?? 0) / 100));
}

/** Lowest current price in the person's currency, preferring verified seller prices. */
export function bestPrice(state: RunState, name: string): Candidate["bestPrice"] {
  const currency = state.requirements?.budget.currency.toUpperCase();
  const usable = pricesFor(state, name).filter((p) => p.amount > 0 && p.kind !== "offer" && (!currency || p.currency.toUpperCase() === currency));
  const lowest = (xs: PriceObservation[]) => xs.reduce<PriceObservation | undefined>((m, p) => (!m || p.amount < m.amount ? p : m), undefined);
  const verified = lowest(usable.filter((p) => p.sourceType !== "article"));
  const pick = verified ?? lowest(usable);
  return pick ? { amount: pick.amount, currency: pick.currency, seller: pick.seller, url: pick.url, verified: !!verified } : undefined;
}

export type BudgetVerdict = "ok" | "over" | "unverified" | "unknown";

export function budgetVerdict(req: Requirements, price: Candidate["bestPrice"]): BudgetVerdict {
  if (!price) return budgetLimit(req) === Infinity ? "ok" : "unknown";
  if (price.amount <= budgetLimit(req)) return price.verified ? "ok" : "unverified";
  // Over budget: only a verified seller price is grounds to rule a product out.
  return price.verified ? "over" : "unverified";
}

export const formatMoney = (amount: number, currency: string) =>
  `${currency.toUpperCase() === "INR" ? "₹" : `${currency} `}${Math.round(amount).toLocaleString(currency.toUpperCase() === "INR" ? "en-IN" : "en-US")}`;
