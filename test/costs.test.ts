import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { config } from "../src/config.ts";
import { BudgetError, checkBudget, chargeUsage, withIO } from "../src/context.ts";
import { costOf, overBudget, priceFor, recordUsage } from "../src/costs.ts";
import { batchTool } from "../src/loop.ts";
import { applyUpdate, resetSettingsCache } from "../src/settings.ts";
import { focusText } from "../src/tools/web.ts";

function freshSettings() {
  config.paths.settings = join(mkdtempSync(join(tmpdir(), "costs-")), "settings.json");
  resetSettingsCache();
}

test("cost of a call: cached input at the cached rate", () => {
  // 1M input of which 600K cached, 100K output on Mistral Small prices.
  const usd = costOf({ input: 0.15, cachedInput: 0.015, output: 0.6 }, { prompt_tokens: 1_000_000, completion_tokens: 100_000, prompt_tokens_details: { cached_tokens: 600_000 } });
  assert.equal(Math.round(usd * 10000) / 10000, Math.round((0.4 * 0.15 + 0.6 * 0.015 + 0.1 * 0.6) * 10000) / 10000);
});

test("prices: defaults, overrides from settings, local models free, unknown models flagged", () => {
  freshSettings();
  assert.equal(priceFor("mistral-small-latest")?.input, 0.15);
  assert.equal(priceFor("qwen2.5:7b", "http://localhost:11434/v1")?.input, 0);
  assert.equal(priceFor("some-new-model"), undefined);
  applyUpdate({ prices: { "some-new-model": { input: 1, output: 2 } } });
  assert.deepEqual(priceFor("some-new-model"), { input: 1, output: 2 });
  const state = { phase: "research", budgetUsd: 0.5 } as any;
  recordUsage(state, { model: "mystery", baseUrl: "https://x", usage: { prompt_tokens: 10, completion_tokens: 5 } });
  assert.deepEqual(state.cost.unpriced, ["mystery"]);
  assert.equal(state.cost.inputTokens, 10);
});

test("the budget pauses the run before the next model call", async () => {
  freshSettings();
  const state = { phase: "research", budgetUsd: 0.01 } as any;
  const io = { state, ask: async () => "", emit: () => {}, trace: () => {} };
  await withIO(io, async () => {
    checkBudget(); // nothing spent yet
    chargeUsage({ model: "mistral-small-latest", baseUrl: "https://api.mistral.ai/v1", usage: { prompt_tokens: 100_000, completion_tokens: 0 } });
    assert.equal(Math.round(state.cost.usd * 1000), 15); // $0.015
    assert.equal(state.cost.byPhase.research, state.cost.usd);
    assert.throws(() => checkBudget(), BudgetError);
  });
  assert.ok(overBudget(state));
  assert.ok(!overBudget({ ...state, budgetUsd: 0 })); // 0 = no limit
});

test("focusText keeps the relevant passages of a long page, in order", () => {
  const filler = "Unrelated navigation text about other things. ".repeat(40);
  const page = `Galaxy Buds X review\n\n${filler}\n\nThe Galaxy Buds X battery lasts 7.5 hours with ANC on.\n\n${filler}\n\nPrice: ₹9,499 at launch.\n\n${filler}`;
  const out = focusText(page, ["Galaxy Buds X", "battery life"], 1200);
  assert.ok(out.length < 1500);
  assert.match(out, /battery lasts 7\.5 hours/);
  assert.match(out, /^Galaxy Buds X review/);
  assert.equal(focusText("short page", ["x"], 1000), "short page");
});

test("batch tools record several items in one call, and still accept one", () => {
  const seen: string[] = [];
  const t = batchTool("record_x", "Save things.", "items", { name: { type: "string" } }, (it) => (seen.push(it.name), `ok ${it.name}`), () => "summary");
  assert.equal(t.run({ items: [{ name: "a" }, { name: "b" }] }), "1. ok a\n2. ok b\nsummary");
  assert.equal(t.run({ name: "c" }), "ok c\nsummary");
  assert.deepEqual(seen, ["a", "b", "c"]);
});
