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
import type { Candidate, PriceObservation, Requirements, ReviewedPrice, RunState } from "./shared.ts";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function pricesFor(state: RunState, name: string): PriceObservation[] {
  return (state.prices ?? []).filter((p) => norm(p.candidate) === norm(name));
}

/** Upper budget limit including the person's flexibility, or Infinity if no budget. */
export function budgetLimit(req: Requirements): number {
  if (!req.budget.max || req.budget.max <= 0) return Infinity;
  return Math.round(req.budget.max * (1 + (req.budget.flexPercent ?? 0) / 100));
}

/**
 * Search and listing pages ("samsung buds 2 pro" on Amazon) mix the product with
 * accessories, copies and other models. A price there isn't this product's price:
 * a ₹1,899 knock-off listed "for Samsung Galaxy Buds 2 Pro" once passed as one.
 */
export function isListingPage(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (/^amazon\./.test(host) && /^\/s(\/|$)/.test(u.pathname)) return true;
    if (/(^|\/)(search|s|find|results?)(\/|$)/i.test(u.pathname)) return true;
    return ["k", "q", "query", "search", "searchterm", "keyword"].some((k) => u.searchParams.has(k));
  } catch {
    return false;
  }
}

/** Price trackers and comparison sites: useful hints, but not a seller's current offer. */
const TRACKERS = ["pricehistory.app", "pricebefore.com", "buyhatke.com", "keepa.com", "camelcamelcamel.com", "smartprix.com", "91mobiles.com", "mysmartprice.com", "pricee.com", "pricedekho.com"];
export const isTracker = (url: string) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return TRACKERS.some((t) => host === t || host.endsWith(`.${t}`));
  } catch {
    return false;
  }
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

/**
 * Every recorded price with code's verdict. "used" prices are seller-page prices
 * that can decide the budget check; "reference" ones are shown but don't count
 * (articles, trackers, MRP, card offers); "excluded" ones look wrong.
 */
export function reviewPrices(state: RunState, name: string): ReviewedPrice[] {
  const currency = state.requirements?.budget.currency.toUpperCase();
  const reviewed: ReviewedPrice[] = pricesFor(state, name).map((p) => {
    if (currency && p.currency.toUpperCase() !== currency) return { ...p, use: "reference", reason: `in ${p.currency}, not ${currency}` };
    if (p.kind === "offer") return { ...p, use: "reference", reason: "needs a card, coupon or exchange" };
    if (p.kind === "list") return { ...p, use: "reference", reason: "list price (MRP), not what sellers charge" };
    if (isListingPage(p.url)) return { ...p, use: "excluded", reason: "from a search/listing page, which mixes in accessories, copies and other models" };
    if (p.sourceType === "article") return { ...p, use: "reference", reason: "quoted in an article, may be out of date" };
    if (isTracker(p.url)) return { ...p, use: "reference", reason: "from a price tracker, not the seller's page" };
    return { ...p, use: "used" };
  });
  // A seller price far below every other seller's is usually a different item
  // (accessory, copy, refurbished part) recorded against this product.
  const used = reviewed.filter((p) => p.use === "used");
  for (const p of used) {
    const others = used.filter((o) => o.amount !== p.amount);
    if (others.length >= 2 && p.amount < 0.5 * median(others.map((o) => o.amount))) {
      p.use = "excluded";
      p.reason = "far below other sellers' prices: likely an accessory, copy or different variant";
    }
  }
  return reviewed;
}

/** Lowest current price in the person's currency, preferring seller-page prices that passed review. */
export function bestPrice(state: RunState, name: string): Candidate["bestPrice"] {
  const reviewed = reviewPrices(state, name);
  const lowest = (xs: PriceObservation[]) => xs.reduce<PriceObservation | undefined>((m, p) => (!m || p.amount < m.amount ? p : m), undefined);
  const verified = lowest(reviewed.filter((p) => p.use === "used"));
  // Unverified fallback: articles and trackers, never card offers, MRP or excluded prices.
  const pick = verified ?? lowest(reviewed.filter((p) => p.use === "reference" && p.kind === "sale" && !/^in [A-Z]+, not/.test(p.reason ?? "")));
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
