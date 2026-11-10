import assert from "node:assert/strict";
import { test } from "node:test";
import { addUserCandidate } from "../src/brief.ts";
import { metricStatus } from "../src/metrics.ts";
import { sampleOrder } from "../src/phases/score.ts";
import { tieGroup } from "../src/scoring.ts";
import type { Candidate, MetricObservation, RunState } from "../src/shared.ts";
import { newCandidate } from "../src/state.ts";
import { rememberPage, verifyQuote } from "../src/tools/web.ts";

test("quotes must really be on the page", () => {
  rememberPage("https://www.example.com/review/?utm_source=x", "The battery lasted 9 hours 35 minutes in our PCMark test, which is excellent.");
  assert.equal(verifyQuote("https://example.com/review", "battery lasted 9 hours 35 minutes in our PCMark test"), "ok");
  // small differences in punctuation/case are fine
  assert.equal(verifyQuote("https://example.com/review", "The Battery lasted 9 hours, 35 minutes in our PCMark test"), "ok");
  // a paraphrase with a different number is not
  assert.equal(verifyQuote("https://example.com/review", "the battery lasted 12 hours in testing"), "not-found");
  assert.equal(verifyQuote("https://never-opened.com/x", "anything at all here"), "not-fetched");
});

const obs = (value: number, url: string): MetricObservation => ({ id: "M", candidate: "P", key: "cam", value, sourceUrl: url, round: 0 });
const st = (metrics: MetricObservation[], sourceDomain?: string) =>
  ({ metrics, metricDefs: { cam: { key: "cam", label: "Cam", unit: "pts", higherIsBetter: true, poor: 100, good: 150, sourceHint: "", sourceDomain } } }) as unknown as RunState;

test("measurements: authority confirms alone, two agreeing sites confirm, disagreement is a conflict", () => {
  assert.deepEqual(metricStatus(st([obs(133, "https://www.dxomark.com/a")], "dxomark.com"), "P", "cam"), { value: 133, confirmed: true, sources: 1 });
  assert.equal(metricStatus(st([obs(133, "https://blog.com/a")], "dxomark.com"), "P", "cam").confirmed, false);
  assert.equal(metricStatus(st([obs(133, "https://a.com/x"), obs(134, "https://b.com/y")]), "P", "cam").confirmed, true);
  const conflict = metricStatus(st([obs(127, "https://a.com/x"), obs(144, "https://b.com/y")]), "P", "cam");
  assert.equal(conflict.confirmed, false);
  assert.match(conflict.conflict!, /127 \(a\.com\) vs 144 \(b\.com\)/);
  // the authoritative value wins over a disagreeing blog
  assert.equal(metricStatus(st([obs(127, "https://blog.com/x"), obs(133, "https://dxomark.com/y")], "dxomark.com"), "P", "cam").value, 133);
});

test("judging order changes between samples so no product is always first", () => {
  const items = ["A", "B", "C"];
  const firsts = [0, 1, 2].map((i) => sampleOrder(items, i)[0]);
  assert.equal(new Set(firsts).size, 3);
  assert.deepEqual([...sampleOrder(items, 1)].sort(), items);
});

const cand = (name: string, total: number, extra: Partial<Candidate> = {}) => ({ ...newCandidate({ name, price: "", whyConsidered: "", source: "", status: "shortlist", round: 0 }), total, ...extra });

test("near-equal leaders are a tie; ruled-out products never join it", () => {
  const ranked = [cand("A", 80), cand("B", 78.5), cand("C", 70)];
  assert.deepEqual(tieGroup(ranked, 3).map((c) => c.name), ["A", "B"]);
  assert.deepEqual(tieGroup([cand("A", 80), cand("X", 79, { disqualified: "over budget" }), cand("C", 70)], 3).map((c) => c.name), ["A"]);
});

test("a product you add is researched and compared, then only the report is redone", () => {
  const state = { phase: "done", round: 1, requirements: { criteria: [] }, candidates: [cand("Alpha", 80), { ...cand("Old", 0), status: "cut", cutReason: "dup" }] } as unknown as RunState;
  assert.deepEqual(addUserCandidate(state, "  Samsung   Galaxy S24 FE ", "friend recommends"), { name: "Samsung Galaxy S24 FE", start: true });
  const added = state.candidates.at(-1)!;
  assert.equal(added.addedByUser, true);
  assert.equal(added.researched, false);
  assert.equal(state.phase, "research");
  assert.equal(state.rescoreOnly, true);
  // a product that was cut earlier comes back
  state.phase = "done";
  assert.deepEqual(addUserCandidate(state, "old", ""), { name: "Old", start: true });
  assert.equal(state.candidates[1].status, "shortlist");
  assert.match((addUserCandidate(state, "alpha", "") as { error: string }).error, /already being compared/);
});
