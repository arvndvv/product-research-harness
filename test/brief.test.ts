import assert from "node:assert/strict";
import { test } from "node:test";
import { applyBriefEdit, planAfterEdit, validateBriefEdit } from "../src/brief.ts";
import type { Candidate, RunState } from "../src/shared.ts";
import { applyHardFilters } from "../src/phases/score.ts";
import { eligible, rank } from "../src/scoring.ts";

function cand(name: string, scores: [number, number], price: number): Candidate {
  return {
    name, price: "", whyConsidered: "", source: "", status: "shortlist", addedInRound: 0, researched: true, followups: [], notes: [], dirty: false,
    scores: [
      { criterion: "camera", score: scores[0], confidence: "high", evidenceIds: [], rationale: "" },
      { criterion: "battery", score: scores[1], confidence: "high", evidenceIds: [], rationale: "" },
    ],
    ruleFails: [],
  };
}

function makeState(): RunState {
  return {
    id: "t", dir: "/tmp", createdAt: "", initialRequest: "phone", phase: "done", round: 0, critiqueNotes: [], evidence: [],
    requirements: {
      category: "phone", summary: "", useCase: "", region: "India",
      budget: { max: 40000, currency: "INR", notes: "", flexPercent: 0 },
      mustHaves: ["5G"], niceToHaves: [], dealbreakers: [],
      criteria: [{ name: "camera", weight: 70, description: "" }, { name: "battery", weight: 30, description: "" }],
      userProfile: [],
    },
    candidates: [cand("CameraPhone", [9, 5], 38000), cand("BatteryPhone", [6, 9], 30000), cand("Flagship", [10, 10], 45000)],
    prices: [
      { id: "P1", candidate: "CameraPhone", amount: 38000, currency: "INR", kind: "sale", seller: "S", url: "https://s", sourceType: "retailer", round: 0 },
      { id: "P2", candidate: "BatteryPhone", amount: 30000, currency: "INR", kind: "sale", seller: "S", url: "https://s", sourceType: "retailer", round: 0 },
      { id: "P3", candidate: "Flagship", amount: 45000, currency: "INR", kind: "sale", seller: "S", url: "https://s", sourceType: "retailer", round: 0 },
    ],
  };
}

const winner = (s: RunState) => rank(s.candidates).find(eligible)?.name;

test("weight change re-ranks in code, no model needed", () => {
  const s = makeState();
  applyHardFilters(s); // what the score phase leaves behind
  assert.equal(winner(s), "CameraPhone");
  assert.equal(applyBriefEdit(s, { weights: { camera: 70, battery: 30 } }).changes.length, 0);
  const r = applyBriefEdit(s, { weights: { camera: 20, battery: 80 } });
  assert.equal(r.needsRescore, false);
  assert.deepEqual(r.changes, ["camera weight 70 → 20", "battery weight 30 → 80"]);
  assert.equal(winner(s), "BatteryPhone");
  assert.equal(planAfterEdit(s, r.needsRescore), "report");
  assert.equal(s.phase, "report");
});

test("raising the budget brings an over-budget product back", () => {
  const s = makeState();
  applyHardFilters(s);
  assert.match(s.candidates[2].disqualified ?? "", /over budget/);
  applyBriefEdit(s, { budget: { max: 45000, flexPercent: 0 } });
  assert.equal(s.candidates[2].disqualified, undefined);
  assert.equal(winner(s), "Flagship");
});

test("changing must-haves needs a re-check by the model, then goes straight to the report", () => {
  const s = makeState();
  const r = applyBriefEdit(s, { mustHaves: ["5G", "wireless charging"] });
  assert.equal(r.needsRescore, true);
  assert.equal(planAfterEdit(s, true), "score");
  assert.equal(s.rescoreOnly, true);
  assert.ok(s.candidates.every((c) => c.dirty));
  assert.equal(s.briefEdits?.length, 1);
});

test("edits are validated", () => {
  const s = makeState();
  assert.match(validateBriefEdit(s, { weights: { camera: 50, battery: 30 } })!, /add up to 100/);
  assert.match(validateBriefEdit(s, { weights: { zoom: 100 } })!, /unknown criterion/);
  assert.match(validateBriefEdit(s, { budget: { max: -1, flexPercent: 0 } })!, /budget/);
  assert.equal(validateBriefEdit(s, { weights: { camera: 0, battery: 100 } }), null);
});
