import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { guideName } from "../src/admin.ts";
import { config } from "../src/config.ts";
import { applyUpdate, llmTarget, loadSettings, missingSettings, resetSettingsCache, settingsView, validateUpdate } from "../src/settings.ts";

function freshSettings(env: Partial<typeof config.llm.main> = {}) {
  config.paths.settings = join(mkdtempSync(join(tmpdir(), "settings-")), "settings.json");
  Object.assign(config.llm.main, { baseUrl: "https://api.mistral.ai/v1", apiKey: "sk-env-1234", model: "mistral-large-latest", ...env });
  Object.assign(config.llm.judge, { ...config.llm.main });
  Object.assign(config.search, { provider: "tavily", tavilyKey: "tvly-abcd" });
  resetSettingsCache();
}

test("first start imports .env into settings.json", () => {
  freshSettings();
  const s = loadSettings();
  assert.equal(s.providers.length, 1);
  assert.equal(s.providers[0].name, "Mistral (from .env)");
  assert.deepEqual(llmTarget("main"), { baseUrl: "https://api.mistral.ai/v1", apiKey: "sk-env-1234", model: "mistral-large-latest", providerName: "Mistral (from .env)" });
  // No separate judge: judge falls back to main.
  assert.equal(llmTarget("judge").model, "mistral-large-latest");
  assert.ok(JSON.parse(readFileSync(config.paths.settings, "utf8")).providers[0].apiKey);
});

test("the browser view never contains keys", () => {
  freshSettings();
  const view = JSON.stringify(settingsView());
  assert.ok(!view.includes("sk-env-1234"));
  assert.ok(!view.includes("tvly-abcd"));
  assert.ok(view.includes("••••1234"));
});

test("adding a provider and switching the judge model needs no restart", () => {
  freshSettings();
  const mistral = loadSettings().providers[0];
  const s = applyUpdate({
    providers: [
      { id: mistral.id, name: mistral.name, baseUrl: mistral.baseUrl }, // key omitted: kept
      { name: "Ollama", baseUrl: "http://localhost:11434/v1/" },
    ],
  });
  const ollama = s.providers[1];
  assert.equal(s.providers[0].apiKey, "sk-env-1234");
  assert.equal(ollama.baseUrl, "http://localhost:11434/v1");
  applyUpdate({ main: { providerId: ollama.id, model: "qwen2.5:7b" }, judge: { providerId: mistral.id, model: "mistral-large-latest" } });
  assert.equal(llmTarget("main").model, "qwen2.5:7b");
  assert.equal(llmTarget("main").apiKey, "");
  assert.equal(llmTarget("judge").baseUrl, "https://api.mistral.ai/v1");
  // Local server without a key is fine.
  assert.deepEqual(missingSettings(), []);
  // Removing a key, and clearing the separate judge.
  applyUpdate({ providers: s.providers.map((p) => ({ id: p.id, name: p.name, baseUrl: p.baseUrl, apiKey: p.id === mistral.id ? null : undefined })), judge: null });
  assert.equal(loadSettings().providers[0].apiKey, undefined);
  assert.equal(llmTarget("judge").model, "qwen2.5:7b");
});

test("settings updates are validated", () => {
  freshSettings();
  const s = loadSettings();
  assert.match(validateUpdate({ providers: [{ name: "X", baseUrl: "not a url" }] }, s)!, /valid URL/);
  assert.match(validateUpdate({ main: { providerId: "nope", model: "m" } }, s)!, /doesn't exist/);
  assert.match(validateUpdate({ main: { providerId: s.providers[0].id, model: " " } }, s)!, /model name/);
  assert.equal(validateUpdate({ main: { providerId: s.providers[0].id, model: "mistral-small-latest" } }, s), null);
});

test("missing keys are reported for remote providers and search", () => {
  freshSettings({ apiKey: "" });
  Object.assign(config.search, { tavilyKey: "" });
  resetSettingsCache();
  assert.deepEqual(missingSettings(), ["an API key for Mistral (from .env)", "a Tavily API key"]);
});

test("domain guide names are sanitised", () => {
  assert.equal(guideName("Smart Phones"), "smart-phones");
  assert.equal(guideName("laptops.md"), "laptops");
  assert.equal(guideName("../../etc/passwd"), "etc-passwd");
  assert.equal(guideName("!"), null);
});

test("Exa search: key is stored, reported when missing, and results are mapped", async () => {
  freshSettings();
  assert.equal(validateUpdate({ search: { provider: "bing" as any } }, loadSettings()), "unknown search service: bing");
  applyUpdate({ search: { provider: "exa" } });
  assert.ok(missingSettings().includes("an Exa API key"));
  applyUpdate({ search: { exaKey: "exa-secret-9876" } });
  assert.equal(settingsView().search.exaKeyHint, "••••9876");
  assert.ok(!JSON.stringify(settingsView()).includes("exa-secret"));
  assert.ok(!missingSettings().includes("an Exa API key"));

  const { search } = await import("../src/tools/web.ts");
  const realFetch = globalThis.fetch;
  let sent: any;
  globalThis.fetch = (async (url: string, init: any) => {
    sent = { url, headers: init.headers, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ results: [{ title: "Review", url: "https://x.example/r", highlights: ["Battery lasts 9 hours.", "Great screen."] }] }));
  }) as any;
  try {
    const r = await search("phone review", 5);
    assert.equal(sent.url, "https://api.exa.ai/search");
    assert.equal(sent.headers["x-api-key"], "exa-secret-9876");
    assert.equal(sent.body.numResults, 5);
    assert.deepEqual(r, [{ title: "Review", url: "https://x.example/r", snippet: "Battery lasts 9 hours. ... Great screen." }]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
