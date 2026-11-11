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

test("judge scores match product names loosely but never ambiguously", async () => {
  const { findScore } = await import("../src/phases/score.ts");
  const scores = [{ product: "Samsung Galaxy S25 FE 5G", score: 7 }, { product: "iQOO 12", score: 6 }];
  assert.equal(findScore(scores, "Samsung Galaxy S25 FE 5G")?.score, 7);
  assert.equal(findScore(scores, "samsung galaxy s25 fe (5g)")?.score, 7);
  assert.equal(findScore(scores, "Galaxy S25 FE")?.score, 7);
  assert.equal(findScore(scores, "IQOO-12")?.score, 6);
  // "Galaxy S25" would match both "S25" and "S25 FE": refuse rather than guess.
  assert.equal(findScore([{ product: "Samsung Galaxy S25" }, { product: "Samsung Galaxy S25 FE" }], "Galaxy S25"), undefined);
});

test("discovery can't finish without every angle, every brand and a saturated search", async () => {
  const { discoveryProblems } = await import("../src/phases/discover.ts");
  const cand = (name: string, via: string, site: string) => ({ name, foundVia: [via], source: `https://${site}/x`, status: "longlist" }) as any;
  const state = {
    candidates: [
      cand("realme Buds T310", "expert_review", "a.com"),
      cand("OnePlus Nord Buds 3", "community", "b.com"),
      cand("boAt Nirvana Ion", "retailer_list", "c.com"),
      cand("Noise Buds N2", "expert_review", "a.com"),
      cand("JBL Wave Beam 2", "community", "b.com"),
      cand("realme Buds Air 6", "retailer_list", "c.com"),
    ],
    discovery: { brands: ["realme", "OnePlus", "boAt", "Noise", "JBL", "Sony"], brandsRuledOut: [{ brand: "Sony", reason: "too" }], searches: 9, searchesSinceNew: 1 },
  } as any;
  const p = discoveryProblems(state).join(" | ");
  assert.match(p, /no product found via: new_launch/);
  assert.match(p, /brands not accounted for: Sony/); // a 3-letter reason isn't a reason
  assert.match(p, /hasn't saturated/);
  state.candidates.push(cand("CMF Buds 2", "new_launch", "d.com"));
  state.discovery.brandsRuledOut = [{ brand: "Sony", reason: "nothing under the budget in India" }];
  state.discovery.searchesSinceNew = 3;
  assert.deepEqual(discoveryProblems(state), []);
});

test("longlist review: remove, add, search more, and added products are always researched", async () => {
  const { discoverPhase, parseLonglistReview } = await import("../src/phases/discover.ts");
  const { withIO } = await import("../src/context.ts");
  const { config } = await import("../src/config.ts");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  config.paths.runs = mkdtempSync(join(tmpdir(), "review-"));

  assert.deepEqual(parseLonglistReview(""), { action: "continue", remove: [], add: [], hint: "" });
  assert.deepEqual(parseLonglistReview("remove: A, B\nadd: C\nmore: gaming laptops"), { action: "more", remove: ["A", "B"], add: ["C"], hint: "gaming laptops" });

  const c = (name: string) => ({ name, status: "longlist", price: "", whyConsidered: "", source: "", foundVia: ["expert_review"], followups: [], notes: [], researched: false }) as any;
  const state = {
    id: "t", dir: config.paths.runs, phase: "discover", round: 0, candidates: [c("Alpha One"), c("Beta Two"), c("Gamma Three")], evidence: [],
    requirements: { category: "x", summary: "s", useCase: "u", region: "India", budget: { max: 0, currency: "INR", notes: "" }, criteria: [], mustHaves: [], niceToHaves: [], dealbreakers: [], userProfile: [] },
    critiqueNotes: [], createdAt: "2026-01-01", initialRequest: "t",
    discovery: { brands: [], brandsRuledOut: [], searches: 5, searchesSinceNew: 3, agentDone: true },
  } as any;
  const asked: any[] = [];
  config.limits.reviewLonglist = true;
  try {
    await withIO(
      {
        emit: () => {},
        trace: () => {},
        ask: async (_q, opts) => {
          asked.push(opts?.longlist?.map((x: any) => x.name));
          return JSON.stringify({ action: "continue", remove: ["Beta Two"], add: ["Delta Four"], hint: "" });
        },
      },
      () => discoverPhase(state),
    );
  } finally {
    config.limits.reviewLonglist = false;
  }
  assert.deepEqual(asked, [["Alpha One", "Beta Two", "Gamma Three"]]);
  const by = (n: string) => state.candidates.find((x: any) => x.name === n);
  assert.equal(by("Beta Two").status, "cut");
  assert.equal(by("Beta Two").cutReason, "Removed by you");
  assert.equal(by("Delta Four").addedByUser, true);
  assert.equal(state.phase, "shortlist");
});

test("measurements: no spec proxies, unit sanity, same numbers for everyone, shared parts, single sources count half", async () => {
  const { specProxy, implausible, comparableKeys, metricScoreFor, dropSpecProxies } = await import("../src/metrics.ts");
  const { combineScores } = await import("../src/phases/score.ts");
  const def = (key: string, label: string, unit: string, poor: number, good: number, extra: object = {}) => ({ key, label, unit, higherIsBetter: good > poor, poor, good, sourceHint: "", ...extra });

  // 1. Specs are not measurements: the laptop run scored a 15 W chip 10/10 for "performance".
  assert.ok(specProxy(def("cpu_thermal_design_power", "CPU Thermal Design Power (TDP)", "W", 45, 15)));
  assert.ok(specProxy(def("cpu_cores", "Core count", "cores", 4, 16)));
  assert.ok(!specProxy(def("geekbench_6_multi_core", "Geekbench 6 Multi-Core Score", "score", 3000, 12000)));
  assert.ok(!specProxy(def("weight", "Weight", "grams", 2000, 1200)));

  // 2. Unit mix-ups are refused: 1.24 recorded for a weight in grams.
  assert.match(implausible(def("weight", "Weight", "grams", 2000, 1200), 1.24) ?? "", /Check the unit/);
  assert.equal(implausible(def("weight", "Weight", "grams", 2000, 1200), 1240), null);

  const geek = def("geekbench_6_multi_core", "Geekbench 6 Multi-Core", "score", 3000, 12000, { component: "processor", sourceDomain: "geekbench.com" });
  const weight = def("weight", "Weight", "grams", 2000, 1200);
  const tdp = def("cpu_thermal_design_power", "TDP", "W", 45, 15);
  const state: any = {
    candidates: [
      { name: "Vivobook", components: { processor: "AMD Ryzen 5 7530U" } },
      { name: "Inspiron", components: { processor: "Intel Core Ultra 5 125H" } },
      { name: "Aspire", components: { processor: "Intel Core Ultra 5 125H" } },
    ],
    metricPlan: [{ criterion: "performance", keys: ["geekbench_6_multi_core", "cpu_thermal_design_power"] }, { criterion: "portability", keys: ["weight"] }],
    metricDefs: { geekbench_6_multi_core: geek, weight, cpu_thermal_design_power: tdp },
    metrics: [
      // Benchmarks measured for the processors (on geekbench.com: confirmed), recorded while researching two of the laptops.
      { id: "M1", candidate: "Vivobook", key: "geekbench_6_multi_core", value: 6000, sourceUrl: "https://browser.geekbench.com/a", round: 0, component: "AMD Ryzen 5 7530U" },
      { id: "M2", candidate: "Inspiron", key: "geekbench_6_multi_core", value: 10200, sourceUrl: "https://browser.geekbench.com/b", round: 0, component: "Intel Core Ultra 5 125H" },
      { id: "M3", candidate: "Vivobook", key: "cpu_thermal_design_power", value: 15, sourceUrl: "https://x.com", round: 0 },
      // Weight only for two of three laptops.
      { id: "M4", candidate: "Inspiron", key: "weight", value: 1240, sourceUrl: "https://a.com", round: 0 },
      { id: "M5", candidate: "Aspire", key: "weight", value: 1200, sourceUrl: "https://b.com", round: 0 },
    ],
  };
  dropSpecProxies(state);
  assert.deepEqual(state.metricPlan[0].keys, ["geekbench_6_multi_core"]);

  // 3. The Aspire shares the Inspiron's processor, so it gets that benchmark.
  const names = ["Vivobook", "Inspiron", "Aspire"];
  assert.deepEqual(comparableKeys(state, names, "performance"), { keys: ["geekbench_6_multi_core"], leftOut: [] });
  const aspire = metricScoreFor(state, "Aspire", "performance", ["geekbench_6_multi_core"]);
  assert.equal(aspire.measured[0].value, 10200);
  assert.equal(aspire.measured[0].via, "Intel Core Ultra 5 125H");
  assert.ok(metricScoreFor(state, "Vivobook", "performance", ["geekbench_6_multi_core"]).score! < aspire.score!);

  // 4. Weight is missing for the Vivobook: it's left out for everyone, not used for some.
  assert.deepEqual(comparableKeys(state, names, "portability"), { keys: [], leftOut: ["Weight"] });

  // 5. A single-source measurement counts half as much.
  assert.equal(combineScores(10, 5, 1), 8.5); // 0.7 x 10 + 0.3 x 5
  assert.equal(combineScores(10, 5, 0), 6.8); // 0.35 x 10 + 0.65 x 5
});
