import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { config } from "../src/config.ts";
import { addProfileFacts, loadProfile, profileText } from "../src/knowledge.ts";
import { stripOuterFence } from "../src/phases/report.ts";

test("profile: duplicates skipped, same topic replaced", () => {
  config.paths.memory = mkdtempSync(join(tmpdir(), "profile-test-"));
  addProfileFacts([{ text: "country: India" }, { text: "shoe size: UK 7", scope: "shoes" }]);
  addProfileFacts([{ text: "Country: India" }, { text: "shoe size: UK 8", scope: "shoes" }, { text: "OS: Android", scope: "smartphones" }]);
  const facts = loadProfile().map((f) => `${f.scope ?? "-"}|${f.text}`);
  assert.deepEqual(facts, ["-|country: India", "shoes|shoe size: UK 8", "smartphones|OS: Android"]);
  assert.equal(profileText(), "- country: India\nFor shoes:\n  - shoe size: UK 8\nFor smartphones:\n  - OS: Android");
});

test("profile: migrates the older profile.md", () => {
  config.paths.memory = mkdtempSync(join(tmpdir(), "profile-test-"));
  writeFileSync(join(config.paths.memory, "profile.md"), "# User profile\n\n- India\n- foot size: UK 7\n");
  assert.deepEqual(loadProfile().map((f) => f.text), ["India", "foot size: UK 7"]);
});

test("stripOuterFence unwraps a fenced markdown answer only", () => {
  assert.equal(stripOuterFence("```markdown\n## Hi\ntext\n```"), "## Hi\ntext");
  const inner = "## Hi\n```js\nx\n```\nmore";
  assert.equal(stripOuterFence(inner), inner);
});
