import assert from "node:assert/strict";
import { test } from "node:test";
import { extractJson } from "../src/llm.ts";
import { validateRequirements } from "../src/phases/intake.ts";
import { computeTotal, rank } from "../src/scoring.ts";
import { newCandidate, type Requirements } from "../src/state.ts";
import { formatRedditThread } from "../src/tools/web.ts";
import { domainOf, htmlToText } from "../src/util/html.ts";

const req: Requirements = {
  category: "running shoes",
  summary: "test",
  useCase: "daily runs",
  budget: { max: 10000, currency: "INR", notes: "" },
  region: "India",
  mustHaves: [],
  niceToHaves: [],
  dealbreakers: [],
  criteria: [
    { name: "comfort", weight: 50, description: "" },
    { name: "durability", weight: 30, description: "" },
    { name: "value", weight: 20, description: "" },
  ],
  userProfile: [],
};

test("htmlToText strips scripts/nav and decodes entities", () => {
  const html = `<html><head><title>Shoe &amp; Review</title><script>var x=1</script></head>
    <body><nav>Menu</nav><h1>Great&nbsp;shoe</h1><p>Fits &lt;wide&gt; feet</p><ul><li>one</li></ul></body></html>`;
  const text = htmlToText(html);
  assert.match(text, /TITLE: Shoe & Review/);
  assert.match(text, /Great shoe/);
  assert.match(text, /Fits <wide> feet/);
  assert.match(text, /- one/);
  assert.doesNotMatch(text, /var x|Menu/);
});

test("domainOf normalises hosts", () => {
  assert.equal(domainOf("https://www.reddit.com/r/x"), "reddit.com");
  assert.equal(domainOf("https://old.reddit.com/r/x"), "reddit.com");
  assert.equal(domainOf("not a url"), "");
});

test("formatRedditThread sorts comments by votes", () => {
  const data = [
    { data: { children: [{ data: { title: "Wide feet?", selftext: "Help", subreddit: "RunningShoeGeeks", score: 42 } }] } },
    {
      data: {
        children: [
          { kind: "t1", data: { body: "low", score: 1 } },
          { kind: "t1", data: { body: "high", score: 99, replies: { data: { children: [{ kind: "t1", data: { body: "reply", score: 5 } }] } } } },
        ],
      },
    },
  ];
  const out = formatRedditThread(data);
  assert.match(out, /r\/RunningShoeGeeks/);
  assert.ok(out.indexOf("high") < out.indexOf("reply") && out.indexOf("reply") < out.indexOf("low"));
});

test("extractJson handles fences and prose", () => {
  assert.equal(JSON.parse(extractJson('Sure:\n```json\n{"a":1}\n```')).a, 1);
  assert.equal(JSON.parse(extractJson('result {"b":2} done')).b, 2);
});

test("computeTotal weights scores to 0-100", () => {
  const total = computeTotal(req, [
    { criterion: "comfort", score: 8, confidence: "high", evidenceIds: [], rationale: "" },
    { criterion: "durability", score: 6, confidence: "high", evidenceIds: [], rationale: "" },
    { criterion: "value", score: 10, confidence: "high", evidenceIds: [], rationale: "" },
  ]);
  assert.equal(total, 40 + 18 + 20);
});

test("rank puts disqualified candidates last", () => {
  const mk = (name: string, total: number, disqualified?: string) => {
    const c = newCandidate({ name, price: "", whyConsidered: "", source: "", status: "shortlist", round: 0 });
    c.total = total;
    c.disqualified = disqualified;
    return c;
  };
  const ranked = rank([mk("A", 70), mk("B", 90, "dealbreaker"), mk("C", 80)]);
  assert.deepEqual(ranked.map((c) => c.name), ["C", "A", "B"]);
});

test("validateRequirements enforces weights summing to 100", () => {
  assert.equal(validateRequirements(req), null);
  const bad = { ...req, criteria: req.criteria.map((c) => ({ ...c, weight: 10 })) };
  assert.match(validateRequirements(bad)!, /sum to 100/);
});

test("run ids are unique even for the same request in the same minute", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { config } = await import("../src/config.ts");
  const { createRun } = await import("../src/state.ts");
  config.paths.runs = mkdtempSync(join(tmpdir(), "ids-"));
  const a = createRun("same request");
  const b = createRun("same request");
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.dir, b.dir);
});

test("domain guides: decision factors drive the interview, the measurement table seeds measurements", async () => {
  const { config } = await import("../src/config.ts");
  const { domainBlock, domainFactors, domainMetrics } = await import("../src/knowledge.ts");
  config.paths.domains = new URL("../domains", import.meta.url).pathname;
  const factors = domainFactors("laptop");
  assert.ok(factors.includes("Refresh rate") && factors.includes("Processor performance"), factors.join(", "));
  const metrics = domainMetrics("laptops for coding");
  const gb = metrics.find((m) => m.key === "geekbench_6_multi_core")!;
  assert.deepEqual({ poor: gb.poor, good: gb.good, higher: gb.higherIsBetter, part: gb.component, domain: gb.sourceDomain }, { poor: 5000, good: 15000, higher: true, part: "processor", domain: "browser.geekbench.com" });
  assert.equal(metrics.find((m) => m.key === "laptop_weight_g")!.higherIsBetter, false);
  // The table is for code; prompts get the rest of the guide.
  const block = domainBlock("laptop");
  assert.ok(!block.includes("| geekbench_6_multi_core") && block.includes("## Pitfalls"));
  assert.ok(domainFactors("wireless earbuds").includes("Noise cancelling (ANC)"));
  assert.ok(domainMetrics("smartphone").some((m) => m.key === "dxomark_camera_score"));
});
