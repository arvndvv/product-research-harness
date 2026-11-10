import assert from "node:assert/strict";
import { test } from "node:test";
import { bestPrice, budgetLimit, budgetVerdict } from "../src/pricing.ts";
import type { PriceObservation, Requirements, RunState } from "../src/shared.ts";

const req = { budget: { max: 50000, currency: "INR", notes: "", flexPercent: 10 } } as Requirements;
const p = (o: Partial<PriceObservation>): PriceObservation => ({
  id: "P", candidate: "Phone", amount: 0, currency: "INR", kind: "sale", seller: "s", url: "https://x", sourceType: "retailer", round: 0, ...o,
});
const stateWith = (prices: PriceObservation[]) => ({ requirements: req, prices }) as unknown as RunState;

test("budget limit includes flex", () => {
  assert.equal(budgetLimit(req), 55000);
});

test("seller prices beat (stale) article prices; offers and other currencies are ignored", () => {
  const s = stateWith([
    p({ amount: 59999, sourceType: "article", kind: "list", seller: "launch news" }),
    p({ amount: 44999, sourceType: "retailer", seller: "Flipkart" }),
    p({ amount: 39999, kind: "offer", seller: "Flipkart bank offer" }),
    p({ amount: 499, currency: "USD", seller: "US store" }),
  ]);
  assert.deepEqual(bestPrice(s, "Phone"), { amount: 44999, currency: "INR", seller: "Flipkart", url: "https://x", verified: true });
});

test("only a verified price can rule a product out", () => {
  const verifiedOver = bestPrice(stateWith([p({ amount: 60000 })]), "Phone");
  assert.equal(budgetVerdict(req, verifiedOver), "over");
  const articleOver = bestPrice(stateWith([p({ amount: 60000, sourceType: "article" })]), "Phone");
  assert.equal(budgetVerdict(req, articleOver), "unverified");
  assert.equal(budgetVerdict(req, undefined), "unknown");
});
