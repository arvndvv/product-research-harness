/**
 * End-to-end pipeline test with a scripted fake model and no network.
 * Proves the phases connect: discover -> shortlist -> research -> score ->
 * critique (iterates once, adds a candidate) -> research -> score -> report.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { config } from "../src/config.ts";
import { loadMetricLibrary } from "../src/library.ts";
import { rememberPage } from "../src/tools/web.ts";

// Pages the fake researcher "read": quotes are checked against these.
const SENTENCE = "Testers found the grip and cushioning hold up well over months of daily running.";
for (let i = 0; i < 8; i++) rememberPage(`https://review${i}.com/p`, `Review page. ${SENTENCE}`);
rememberPage("https://www.reddit.com/r/x/comments/1", `Owner thread. ${SENTENCE}`);
rememberPage("https://lab.example.com/test", "Lab weights: Shoe A weighs 250 g. Shoe B weighs 300 g. Shoe Z weighs 220 g.");
rememberPage("https://shop.example.in/p", "Prices: Shoe A ₹12,000. Shoe B ₹9,500. Shoe Z ₹8,000. Others ₹9,000.");
import { setChatImpl, type AssistantMessage, type ChatRequest } from "../src/llm.ts";
import { critiquePhase } from "../src/phases/critique.ts";
import { discoverPhase, shortlistPhase } from "../src/phases/discover.ts";
import { reportPhase } from "../src/phases/report.ts";
import { researchPhase } from "../src/phases/research.ts";
import { scorePhase } from "../src/phases/score.ts";
import { createRun, type Phase, type RunState } from "../src/state.ts";

let id = 0;
const call = (name: string, args: object): AssistantMessage => ({
  role: "assistant",
  content: null,
  tool_calls: [{ id: `c${++id}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
});
const json = (v: object): AssistantMessage => ({ role: "assistant", content: JSON.stringify(v) });
const stepOf = (req: ChatRequest) => req.messages.filter((m) => m.role === "assistant").length;
const criteria = ["comfort", "durability", "value"];
let critiques = 0;

function fakeModel(req: ChatRequest): AssistantMessage {
  const system = req.messages[0].content as string;
  const tools = req.tools?.map((t) => t.function.name) ?? [];

  // Judgement phases must use the judge model profile; agent loops use main.
  const judgement = ["pick which products", "You define OBJECTIVE", "compare products on ONE criterion", "check ONE product against", "skeptical senior reviewer", "final recommendation"].some((k) =>
    system.includes(k),
  );
  assert.equal(req.profile ?? "main", judgement ? "judge" : "main", `wrong model profile for: ${system.slice(0, 60)}`);

  if (tools.includes("add_candidate")) {
    const step = stepOf(req);
    if (step < 6) return call("add_candidate", { name: `Shoe ${"ABCDEF"[step]}`, approx_price: "8000 INR", why: "fits", source_url: `https://site${step % 3}.com/x` });
    return call("finish_longlist", { notes: "ok" });
  }
  if (tools.includes("record_evidence")) {
    const step = stepOf(req);
    const task = req.messages[1].content as string;
    const followup = task.startsWith("Follow-up");
    const product = task.match(/"([^"]+)"/)![1];
    // Shoe C's researcher never manages to gather evidence: it should be retried, then marked incomplete.
    if (product === "Shoe C") return call("finish_research", { summary: "nothing found" });
    // Every product gets one seller price first. Shoe A is over budget (limit 10000).
    if (!followup && step === 0) {
      const amount = { "Shoe A": 12000, "Shoe B": 9500, "Shoe Z": 8000 }[product] ?? 9000;
      return call("record_price", { amount, currency: "INR", kind: "sale", seller: "Shop", url: "https://shop.example.in/p", source_type: "retailer", quote: `${product} ₹${amount.toLocaleString("en-IN")}` });
    }
    // Then the planned measurement (weight in grams, lower is better).
    if (!followup && step === 1) {
      const grams = { "Shoe A": 250, "Shoe B": 300, "Shoe Z": 220 }[product] ?? 300;
      return call("record_metric", { metric: "weight_g", value: grams, source_url: "https://lab.example.com/test", quote: `${product} weighs ${grams} g` });
    }
    const first = followup ? 0 : 2;
    const total = followup ? 2 : 8;
    if (step < total) {
      const i = step - first;
      return call("record_evidence", {
        criterion: criteria[i % 3],
        finding: `finding ${product} ${step}`,
        sentiment: "positive",
        source_url: i === 0 ? "https://www.reddit.com/r/x/comments/1" : `https://review${i}.com/p`,
        source_type: i === 0 ? "community" : "expert_review",
        quote: SENTENCE,
      });
    }
    return call("finish_research", { summary: "done" });
  }
  if (system.includes("pick which products")) {
    return json({ shortlist: [{ name: "Shoe A", reason: "r" }, { name: "Shoe B", reason: "r" }, { name: "Shoe C", reason: "r" }], cut: [] });
  }
  if (system.includes("You define OBJECTIVE")) {
    return json({
      criteria: criteria.map((c) => ({
        criterion: c,
        metrics: c === "comfort" ? [{ key: "weight_g", label: "Weight", unit: "g", higher_is_better: false, poor: 400, good: 200, source_hint: "lab", source_domain: "lab.example.com" }] : [],
      })),
    });
  }
  if (system.includes("check ONE product against")) return json({ must_haves: [{ item: "5G", met: "yes", evidence_ids: [] }], dealbreakers_hit: [] });
  if (system.includes("compare products on ONE criterion")) {
    // All products are compared together in one call.
    const user = req.messages[1].content as string;
    const names = [...user.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
    const base: Record<string, number> = { "Shoe A": 9.5, "Shoe B": 7, "Shoe C": 9.8, "Shoe Z": 9 };
    return json({ scores: names.map((n) => ({ product: n, score: base[n] ?? 5, rationale: "compared E1" })) });
  }
  if (system.includes("skeptical senior reviewer")) {
    critiques++;
    if (critiques === 1) {
      return json({
        verdict: "iterate",
        notes: "close race",
        research_tasks: [{ candidate: "Shoe B", question: "durability past 500km?" }],
        new_candidates: [
          { name: "Shoe Z", reason: "better fit", expected_price: 8500 },
          { name: "Shoe Luxe", reason: "premium", expected_price: 30000 },
        ],
      });
    }
    return json({ verdict: "done", notes: "solid", research_tasks: [], new_candidates: [] });
  }
  if (system.includes("final recommendation")) {
    // The winner is chosen by code: over-budget Shoe A and incomplete Shoe C can't be it.
    assert.match(system, /the winner is "Shoe Z"/);
    return { role: "assistant", content: "## Recommendation: Shoe Z\nBecause [E1]." };
  }
  throw new Error(`fake model got unexpected request: ${system.slice(0, 80)}`);
}

test("full pipeline iterates once and recommends the best-scoring product", async () => {
  config.paths.runs = mkdtempSync(join(tmpdir(), "harness-test-"));
  config.paths.knowledge = mkdtempSync(join(tmpdir(), "harness-knowledge-"));
  setChatImpl(async (req) => fakeModel(req));

  const state: RunState = createRun("test shoes");
  state.requirements = {
    category: "test gadget",
    summary: "tester",
    useCase: "testing",
    budget: { max: 10000, currency: "INR", notes: "", flexPercent: 0 },
    region: "India",
    mustHaves: ["5G"],
    niceToHaves: [],
    dealbreakers: [],
    criteria: criteria.map((name, i) => ({ name, weight: [50, 30, 20][i], description: "" })),
    userProfile: [],
  };
  state.phase = "discover" as Phase;

  const phases: Partial<Record<Phase, (s: RunState) => Promise<void>>> = {
    discover: discoverPhase, shortlist: shortlistPhase, research: researchPhase,
    score: scorePhase, critique: critiquePhase, report: reportPhase,
  };
  const visited: string[] = [];
  const log = console.log;
  console.log = () => {};
  try {
    while (state.phase !== "done") {
      visited.push(state.phase);
      await phases[state.phase]!(state);
    }
  } finally {
    console.log = log;
  }

  assert.deepEqual(visited, ["discover", "shortlist", "research", "score", "critique", "research", "score", "critique", "report"]);
  assert.equal(state.round, 1);
  // Critic's over-budget suggestion was skipped; Shoe Z was added.
  assert.ok(!state.candidates.some((c) => c.name === "Shoe Luxe"));
  assert.equal(state.candidates.filter((c) => c.status === "shortlist").length, 4);
  const byName = (n: string) => state.candidates.find((c) => c.name === n)!;
  // Highest score, but a verified seller price is over budget: ruled out in code.
  assert.match(byName("Shoe A").disqualified ?? "", /over budget/);
  // Research never met the bar (even after a retry): incomplete, can't win despite the top score.
  assert.match(byName("Shoe C").incomplete ?? "", /couldn't gather enough evidence/);
  // comfort = 0.7 x measured (220 g on a 400..200 scale = 9) + 0.3 x compared (9) = 9; others compared 9 -> 90
  assert.equal(byName("Shoe Z").total, 90);
  const comfort = byName("Shoe Z").scores!.find((x) => x.criterion === "comfort")!;
  assert.equal(comfort.metricScore, 9);
  assert.deepEqual(comfort.measured?.map((m) => m.value), [220]);
  // The measurement definition was saved for future runs in this category.
  assert.ok(loadMetricLibrary("test gadget").weight_g);
  assert.deepEqual(byName("Shoe Z").bestPrice, { amount: 8000, currency: "INR", seller: "Shop", url: "https://shop.example.in/p", verified: true });
  const report = readFileSync(state.reportPath!, "utf8");
  assert.match(report, /Recommendation: Shoe Z/);
  assert.match(report, /## Scoreboard/);
  assert.match(readFileSync(join(state.dir, "notes.md"), "utf8"), /## Evidence/);
});
