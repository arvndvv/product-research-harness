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

test("the Buds case: search-page knock-offs and trackers don't become the price", async () => {
  const { reviewPrices, isListingPage } = await import("../src/pricing.ts");
  assert.ok(isListingPage("https://www.amazon.in/samsung-buds-2-pro/s?k=samsung+buds+2+pro&page=2"));
  assert.ok(isListingPage("https://www.flipkart.com/search?q=buds"));
  assert.ok(!isListingPage("https://www.flipkart.com/samsung-galaxy-buds2-pro-sm-r510nzaainu-bluetooth-headset/p/itm3d988d0944240"));
  const s = stateWith([
    p({ id: "P1", amount: 1899, url: "https://www.amazon.in/samsung-buds-2-pro/s?k=samsung+buds+2+pro", seller: "Amazon (listing)" }),
    p({ id: "P2", amount: 14999, url: "https://pricehistory.app/p/samsung-galaxy-buds2-pro", seller: "amazon.in" }),
    p({ id: "P3", amount: 12350, url: "https://www.flipkart.com/samsung-galaxy-buds2-pro/p/itm3d9", seller: "Flipkart" }),
  ]);
  assert.deepEqual(bestPrice(s, "Phone"), { amount: 12350, currency: "INR", seller: "Flipkart", url: "https://www.flipkart.com/samsung-galaxy-buds2-pro/p/itm3d9", verified: true });
  const r = Object.fromEntries(reviewPrices(s, "Phone").map((x) => [x.id, x.use]));
  assert.deepEqual(r, { P1: "excluded", P2: "reference", P3: "used" });
});

test("a seller price far below the others is treated as a different item", async () => {
  const s = stateWith([
    p({ id: "P1", amount: 2199, url: "https://shop-a.example/p/1" }),
    p({ id: "P2", amount: 11999, url: "https://shop-b.example/p/2" }),
    p({ id: "P3", amount: 12499, url: "https://shop-c.example/p/3" }),
  ]);
  assert.equal(bestPrice(s, "Phone")?.amount, 11999);
});
