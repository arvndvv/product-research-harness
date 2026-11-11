import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { config } from "../src/config.ts";
import { withIO } from "../src/context.ts";
import { addProfileFacts, loadProfile } from "../src/knowledge.ts";
import { setChatImpl, type ChatRequest } from "../src/llm.ts";
import { checkTurn, intakePhase, questionOverlap, unconfirmedProfileFacts } from "../src/phases/intake.ts";
import { createRun } from "../src/state.ts";

const requirements = {
  category: "smartphone",
  summary: "Wants a phone for photos and social media.",
  use_case: "daily photos, social media",
  budget_max: 50000,
  currency: "INR",
  budget_flex_percent: 0,
  region: "India",
  must_haves: ["5G"],
  nice_to_haves: [],
  dealbreakers: ["heavy"],
  criteria: [
    { name: "camera", weight: 40, description: "best camera in segment" },
    { name: "battery", weight: 30, description: "all-day" },
    { name: "design", weight: 30, description: "premium, light" },
  ],
  assumptions: ["Android"],
};

test("checkTurn rejects questions about things already known (incl. implied)", () => {
  const known = [{ topic: "camera priority", value: "high (photography is a main use)", source: "implied" as const }];
  const problem = checkTurn(
    { known, next_question: { question: "How often do you take photos?", why_it_matters: "x", resolves: "camera priority" }, requirements: null },
    [],
    3,
  );
  assert.match(problem!, /already know "camera priority"/);
});

test("profile preferences must be confirmed, not assumed (country/currency excepted)", () => {
  const known = [
    { topic: "OS", value: "Android", source: "profile" as const },
    { topic: "country", value: "India", source: "profile" as const },
  ];
  const finishing = { known, next_question: null, requirements };
  assert.match(checkTurn(finishing, [], 3)!, /suggestions, not answers.*"OS: Android"/);
  // Once asked (with the saved value as suggestion), finishing is allowed.
  assert.equal(checkTurn(finishing, [{ question: "Still prefer Android?", answer: "Android", resolves: "OS" }], 2), null);
  // Combined confirmation question covering several topics.
  assert.deepEqual(unconfirmedProfileFacts([...known, { topic: "brand", value: "any", source: "profile" }], [{ question: "Still Android, any brand?", answer: "yes", resolves: "OS, brand" }]), []);
  // Out of questions: allowed to finish; intake lists them as assumptions instead.
  assert.equal(checkTurn(finishing, [], 0), null);
});

test("checkTurn rejects near-duplicate questions and enforces the question budget", () => {
  const qa = [{ question: "What is your budget for the phone?", answer: "50k" }];
  const dup = checkTurn({ known: [], next_question: { question: "What budget do you have for this phone?", why_it_matters: "x", resolves: "budget2" }, requirements: null }, qa, 3);
  assert.match(dup!, /nearly the same/);
  const outOfQuestions = checkTurn({ known: [], next_question: { question: "Color?", why_it_matters: "x", resolves: "color" }, requirements: null }, qa, 0);
  assert.match(outOfQuestions!, /no questions left/);
  assert.equal(checkTurn({ known: [], next_question: null, requirements }, qa, 0), null);
  assert.ok(questionOverlap("What is your budget for the phone?", "Which colour do you like?") < 0.3);
});

test("intake: asks, confirms, saves only stated facts to the profile (scoped)", async () => {
  config.paths.runs = mkdtempSync(join(tmpdir(), "intake-runs-"));
  config.paths.memory = mkdtempSync(join(tmpdir(), "intake-mem-"));
  // No domain guides or saved factor lists: this test is about the question flow and the profile.
  config.paths.domains = mkdtempSync(join(tmpdir(), "intake-domains-"));
  config.paths.knowledge = mkdtempSync(join(tmpdir(), "intake-knowledge-"));
  addProfileFacts([{ text: "OS: Android", scope: "smartphones" }]);
  let call = 0;
  setChatImpl(async (req: ChatRequest) => {
    call++;
    const user = req.messages[1].content as string;
    const profileKnown = [{ topic: "OS", value: "Android", source: "profile" }];
    if (call === 1) {
      assert.match(user, /Questions left: 6/);
      assert.match(user, /For smartphones:\n  - OS: Android/);
      // Model tries to skip the saved preference: code must reject this turn.
      return { role: "assistant", content: JSON.stringify({ known: profileKnown, next_question: null, requirements }) };
    }
    if (call === 2) {
      assert.match(req.messages.at(-1)!.content as string, /suggestions, not answers/);
      return { role: "assistant", content: JSON.stringify({ known: profileKnown, next_question: { question: "Android or iPhone?", why_it_matters: "ecosystem", resolves: "OS", suggested_answer: "Android", options: ["Android", "iPhone"] }, requirements: null }) };
    }
    assert.match(user, /A: Android/);
    return {
      role: "assistant",
      content: JSON.stringify({
        known: [{ topic: "OS", value: "Android", source: "profile" }],
        next_question: null,
        requirements,
        profile_updates: [
          { fact: "country: India", scope: "" },
          { fact: "OS: Android", scope: "smartphones" },
          { fact: "hand size: likely small", scope: "smartphones" },
        ],
      }),
    };
  });

  const state = createRun("phone for photos under 50k");
  const asked: string[] = [];
  await withIO(
    {
      ask: async (q, opts) => {
        asked.push(`${q}|${opts?.progress ?? ""}|${opts?.suggestion ?? ""}`);
        return q.startsWith("Android") ? "Android" : "Yes, looks right";
      },
      emit: () => {},
      trace: () => {},
    },
    () => intakePhase(state),
  );

  assert.deepEqual(asked, ["Android or iPhone?|Question 1 of up to 6|Android", "Does this capture what you need? Accept, or type what to change.||"]);
  assert.equal(state.phase, "discover");
  assert.equal(state.requirements?.budget.max, 50000);
  // The guess ("likely small") is dropped; scoped facts keep their scope.
  assert.deepEqual(loadProfile().map((f) => `${f.scope ?? "-"}|${f.text}`), ["smartphones|OS: Android", "-|country: India"]);
});

test("the interview must account for every decision factor: asked, known, in the brief, or an assumption", async () => {
  const { unaccountedFactors } = await import("../src/phases/intake.ts");
  const factors = ["processor performance", "display quality", "refresh rate", "battery life", "weight"];
  const turn: any = {
    known: [{ topic: "use", value: "Java, Docker", source: "said" }],
    requirements: { criteria: [{ name: "performance", weight: 60, description: "fast builds" }, { name: "portability", weight: 40, description: "easy to carry" }], assumptions: [] },
  };
  // "weight" is only a JSON key here (criterion weights), so it isn't accounted for yet.
  assert.deepEqual(unaccountedFactors(factors, turn, []), ["display quality", "refresh rate", "battery life", "weight"]);
  turn.requirements.assumptions = ["Display: a standard full-HD screen is fine", "Refresh rate: 60 Hz is fine", "Weight: under 1.5 kg"];
  const qa = [{ question: "How many hours on battery do you need?", answer: "6", resolves: "battery" }];
  assert.deepEqual(unaccountedFactors(factors, turn, qa), []);
  // And checkTurn turns that into a fix-it message for the model.
  const finishing: any = { ...turn, next_question: null, requirements: { ...turn.requirements, assumptions: [] } };
  assert.match(checkTurn(finishing, [], 0, factors) ?? "", /display quality, refresh rate, battery life, weight/);
});
