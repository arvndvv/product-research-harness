import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { config } from "../src/config.ts";
import { categoryKey, loadMetricLibrary, mergeMetricLibrary, saveProduct } from "../src/library.ts";
import { measuredValue, scaleMetric } from "../src/metrics.ts";
import { gateProblems, importFromCache } from "../src/phases/research.ts";
import { combineScores, computeConfidence } from "../src/phases/score.ts";
import type { MetricDef, RunState } from "../src/shared.ts";
import { newCandidate } from "../src/state.ts";

const camera: MetricDef = { key: "dxomark_camera", label: "DXOMARK camera", unit: "pts", higherIsBetter: true, poor: 100, good: 150, sourceHint: "dxomark.com" };
const weight: MetricDef = { key: "weight_g", label: "Weight", unit: "g", higherIsBetter: false, poor: 230, good: 160, sourceHint: "spec sheet" };

test("measurements map onto a fixed 0-10 scale, both directions, clamped", () => {
  assert.equal(scaleMetric(camera, 133), 6.6); // S24 (Exynos)
  assert.equal(scaleMetric(camera, 127), 5.4); // S23 FE: lower, as it should be
  assert.equal(scaleMetric(camera, 170), 10);
  assert.equal(scaleMetric(weight, 160), 10);
  assert.equal(scaleMetric(weight, 195), 5);
  assert.equal(scaleMetric(weight, 260), 0);
});

test("measured value is the median of observations (one odd source can't swing it)", () => {
  const state = { metrics: [130, 133, 190].map((value, i) => ({ id: `M${i}`, candidate: "Phone", key: "dxomark_camera", value, sourceUrl: "x", round: 0 })) } as unknown as RunState;
  assert.equal(measuredValue(state, "Phone", "dxomark_camera"), 133);
});

test("combining and confidence are deterministic", () => {
  assert.equal(combineScores(6.6, 8), 7);
  assert.equal(combineScores(undefined, 8), 8);
  assert.equal(computeConfidence(1, 2, 0, 0), "high");
  assert.equal(computeConfidence(0, 0, 3, 2), "high");
  assert.equal(computeConfidence(0.5, 2, 1, 1), "medium");
  assert.equal(computeConfidence(0, 0, 1, 1), "low");
});

test("library keeps existing scales; plural/singular categories share a library", () => {
  config.paths.knowledge = mkdtempSync(join(tmpdir(), "lib-"));
  assert.equal(categoryKey("Smartphones"), categoryKey("smartphone"));
  mergeMetricLibrary("smartphones", [camera]);
  mergeMetricLibrary("smartphone", [{ ...camera, poor: 50, good: 300 }, weight]);
  const lib = loadMetricLibrary("Smartphone");
  assert.equal(lib.dxomark_camera.poor, 100); // not redefined
  assert.ok(lib.weight_g);
});

test("earlier research is carried in as dated evidence, but fresh research is still required", () => {
  config.paths.knowledge = mkdtempSync(join(tmpdir(), "cache-"));
  const now = new Date().toISOString();
  const ev = (criterion: string, i: number, sourceType: "community" | "expert_review" = "expert_review") => ({
    candidate: "Phone X", criterion, finding: `fact ${criterion} ${i}`, sentiment: "positive" as const, sourceUrl: `https://site${i}.com/a`, sourceType,
  });
  saveProduct("phones", {
    name: "Phone X",
    updatedAt: now,
    evidence: [ev("camera", 1, "community"), ev("camera", 2), ev("battery", 3), ev("battery", 4), ev("camera", 5), ev("battery", 6)],
    metrics: [{ candidate: "Phone X", key: "dxomark_camera", value: 133, sourceUrl: "https://dxomark.com/x" }],
    prices: [{ candidate: "Phone X", amount: 39999, currency: "INR", kind: "sale", seller: "Shop", url: "https://shop.in/x", sourceType: "retailer", seenAt: now }],
  });
  const state = {
    id: "r", dir: mkdtempSync(join(tmpdir(), "run-")), createdAt: now, initialRequest: "phone", phase: "research", round: 0, critiqueNotes: [], evidence: [],
    requirements: {
      category: "phones", summary: "", useCase: "", region: "India", budget: { max: 50000, currency: "INR", notes: "" },
      mustHaves: [], niceToHaves: [], dealbreakers: [], userProfile: [],
      criteria: [{ name: "camera", weight: 60, description: "" }, { name: "battery", weight: 40, description: "" }],
    },
    metricPlan: [{ criterion: "camera", keys: ["dxomark_camera"] }, { criterion: "battery", keys: [] }],
    metricDefs: { dxomark_camera: { ...camera, sourceDomain: "dxomark.com" } },
    candidates: [newCandidate({ name: "Phone X", price: "", whyConsidered: "", source: "", status: "shortlist", round: 0 })],
  } as RunState;

  assert.equal(importFromCache(state, state.candidates[0]), true);
  assert.equal(state.evidence.length, 6);
  assert.equal(state.evidence[0].cachedFrom, now.slice(0, 10));
  assert.equal(measuredValue(state, "Phone X", "dxomark_camera"), 133);
  assert.equal(state.prices, undefined, "prices are never reused");
  const problems = gateProblems(state, state.candidates[0], false, 0).join(" | ");
  assert.match(problems, /no current price/);
  assert.match(problems, /only 0 new findings this run/);
  assert.doesNotMatch(problems, /measurements confirmed/); // the lab's own value counts as confirmed
});
