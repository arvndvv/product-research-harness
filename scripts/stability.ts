/**
 * Stability test: how often does the harness reach the same answer?
 *
 *   npm run stability -- runs/<a finished run>            (3 runs)
 *   npm run stability -- runs/<a finished run> --runs 5
 *
 * Re-runs that run's brief (the interview answers are reused, so no questions)
 * several times from scratch: no earlier evidence, no "products seen before".
 * The measurement scale for the category IS kept, because that's part of the
 * design. Then it reports how often the runs agree.
 *
 * If runs agree, it's because each one found the same evidence, not because
 * they copied each other. This is the number to watch when changing prompts,
 * gates or scoring: a change that lowers agreement made the harness less reliable.
 *
 * Faster, stage by stage:
 *   npm run stability -- runs/<run> --stage discover [--runs 3] [--expect "Product A; Product B"]
 *     Runs only discovery (a few minutes each) and reports how much the runs agree
 *     on which products exist, and RECALL: how many of the products you expect a
 *     careful search to find actually came up. --expect also takes a text file
 *     (one product per line); without it, knowledge/<category>/expected.txt is used if present.
 *
 * Cost: N full research runs (or N discoveries with --stage discover). To try it without API calls, use the demo model:
 *   DEMO_MODEL=1 RUNS_DIR=demo-runs KNOWLEDGE_DIR=demo-knowledge npm run stability -- demo-runs/<run>
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config.ts";
import { withIO } from "../src/context.ts";
import { categoryKey } from "../src/library.ts";
import { discoverPhase } from "../src/phases/discover.ts";
import { runPipeline } from "../src/runner.ts";
import { eligible, rank, tieGroup } from "../src/scoring.ts";
import type { RunState } from "../src/shared.ts";
import { createRun, loadState, logEvent } from "../src/state.ts";
import { printEvent } from "../src/ui.ts";

if (process.env.DEMO_MODEL) (await import("./demo-model.ts")).installDemoModel();

type RunResult = { id: string; winner?: string; tie: string[]; top3: string[]; totals: Record<string, number>; found: string[] };

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const flagValues = new Set(["--runs", "--stage", "--expect"].map((f) => flag(f)).filter(Boolean));
const baseDir = args.find((a) => !a.startsWith("--") && !flagValues.has(a));
const n = Number(flag("--runs")) || 3;
const stage = flag("--stage") ?? "all";
if (!["all", "discover"].includes(stage)) {
  console.error('--stage must be "discover" (or leave it out for full runs)');
  process.exit(1);
}
if (!baseDir) {
  console.error("Usage: npm run stability -- runs/<finished run folder> [--runs 3]");
  process.exit(1);
}

const base = loadState(baseDir);
if (!base.requirements) {
  console.error("That run has no brief yet (the interview didn't finish).");
  process.exit(1);
}
const req = base.requirements;

// Fresh knowledge: keep only the category's measurement scale.
const originalKnowledge = config.paths.knowledge;
const freshKnowledge = mkdtempSync(join(tmpdir(), "stability-knowledge-"));
const metricsFile = join(originalKnowledge, categoryKey(req.category), "metrics.json");
if (existsSync(metricsFile)) {
  mkdirSync(join(freshKnowledge, categoryKey(req.category)), { recursive: true });
  copyFileSync(metricsFile, join(freshKnowledge, categoryKey(req.category), "metrics.json"));
}
config.paths.knowledge = freshKnowledge;
config.cache.researchDays = 0;
config.limits.reviewLonglist = false; // nobody to answer the longlist review

// What a careful search should find, for measuring discovery recall.
const expectArg = flag("--expect");
const expectFile = expectArg && existsSync(expectArg) ? expectArg : join(originalKnowledge, categoryKey(req.category), "expected.txt");
const expected = (expectArg && !existsSync(expectArg) ? expectArg.split(";") : existsSync(expectFile) ? readFileSync(expectFile, "utf8").split(/\r?\n/) : [])
  .map((s) => s.trim())
  .filter((s) => s && !s.startsWith("#"));

const outDir = join(config.paths.runs, `stability-${stage === "discover" ? "discover-" : ""}${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}-${base.id.slice(16, 40)}`);
mkdirSync(outDir, { recursive: true });
config.paths.runs = outDir;

console.log(`Stability test: ${n} independent runs of "${base.initialRequest}" (category: ${req.category})`);
console.log(`Results in ${outDir}\n`);

if (stage === "discover") {
  await discoverStability();
  process.exit(0);
}

const results: RunResult[] = [];
for (let i = 1; i <= n; i++) {
  const state: RunState = createRun(`${base.initialRequest} (stability ${i})`);
  state.requirements = structuredClone(req);
  state.phase = "discover";
  console.log(`--- Run ${i}/${n} (${state.id})`);
  await withIO(
    {
      ask: async () => {
        throw new Error("the stability test can't answer questions");
      },
      emit: (e) => {
        if (e.type === "phase" || (e.type === "log" && (e.level === "warn" || e.level === "ok"))) printEvent(e);
      },
      trace: (e) => logEvent(state, e),
      state,
    },
    () => runPipeline(state),
  );
  const ranked = rank(state.candidates);
  const ok = ranked.filter(eligible);
  results.push({
    id: state.id,
    winner: ok[0]?.name,
    tie: tieGroup(ranked, config.scoring.tieMargin).map((c) => c.name),
    top3: ok.slice(0, 3).map((c) => c.name),
    totals: Object.fromEntries(ranked.map((c) => [c.name, c.total ?? 0])),
    found: state.candidates.map((c) => c.name),
  });
}

// --- Agreement ------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const jaccard = (a: string[], b: string[]) => {
  const A = new Set(a.map(norm));
  const B = new Set(b.map(norm));
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  return union ? inter / union : 1;
};
const pairs: [RunResult, RunResult][] = [];
for (let i = 0; i < results.length; i++) for (let j = i + 1; j < results.length; j++) pairs.push([results[i], results[j]]);
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 1);

const winners = results.map((r) => r.winner ?? "(none)");
const winnerCounts = Object.entries(winners.reduce<Record<string, number>>((m, w) => ((m[norm(w)] = (m[norm(w)] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
const winnerAgreement = winnerCounts[0][1] / results.length;
// A tie counts as agreement when the other run's winner is inside it.
const tieAware = avg(pairs.map(([a, b]) => (a.winner && b.winner && (norm(a.winner) === norm(b.winner) || a.tie.map(norm).includes(norm(b.winner)) || b.tie.map(norm).includes(norm(a.winner))) ? 1 : 0)));
const top3Overlap = avg(pairs.map(([a, b]) => jaccard(a.top3, b.top3)));
const foundOverlap = avg(pairs.map(([a, b]) => jaccard(a.found, b.found)));

const allProducts = [...new Set(results.flatMap((r) => Object.keys(r.totals)))];
const spreads = allProducts
  .map((p) => {
    const vals = results.map((r) => r.totals[p]).filter((v): v is number => v !== undefined);
    return { p, n: vals.length, min: Math.min(...vals), max: Math.max(...vals) };
  })
  .filter((x) => x.n >= 2)
  .sort((a, b) => b.max - b.min - (a.max - a.min));

const pct = (x: number) => `${Math.round(x * 100)}%`;
const lines = [
  `# Stability test: ${base.initialRequest}`,
  "",
  `${results.length} independent runs, no earlier evidence reused. Category scale kept.`,
  "",
  "| | |",
  "|---|---|",
  `| Same winner | ${pct(winnerAgreement)} (${winnerCounts.map(([w, c]) => `${w} ×${c}`).join(", ")}) |`,
  `| Same winner, counting ties | ${pct(tieAware)} of run pairs |`,
  `| Top-3 overlap | ${pct(top3Overlap)} average between runs |`,
  `| Products found overlap | ${pct(foundOverlap)} average between runs |`,
  "",
  "## Each run",
  "",
  ...results.map((r, i) => `- Run ${i + 1}: winner **${r.winner ?? "none"}**${r.tie.length >= 2 ? ` (tied: ${r.tie.join(", ")})` : ""}; top 3: ${r.top3.join(", ")}`),
  "",
  "## Score spread per product (products found in 2+ runs)",
  "",
  "| Product | Runs | Lowest | Highest | Spread |",
  "|---|---|---|---|---|",
  ...spreads.map((s) => `| ${s.p} | ${s.n} | ${s.min} | ${s.max} | ${Math.round((s.max - s.min) * 10) / 10} |`),
  "",
  "How to read this: a large spread on one product means its evidence differs between runs (look at its findings in the run folders).",
  "A low products-found overlap means discovery is the unstable part; low top-3 overlap with high products-found overlap means scoring is.",
];
writeFileSync(join(outDir, "stability.md"), lines.join("\n") + "\n");
console.log("\n" + lines.slice(4, 10).join("\n"));
console.log(`\nFull report: ${join(outDir, "stability.md")}`);

// --- Discovery only: agreement on what exists, and recall -------------------------------

async function discoverStability() {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const same = (a: string, b: string) => {
    const x = key(a);
    const y = key(b);
    return x === y || (Math.min(x.length, y.length) > 4 && (x.includes(y) || y.includes(x)));
  };
  const runs: { found: string[]; searches: number; gaps?: string; ruledOut: string[] }[] = [];
  for (let i = 1; i <= n; i++) {
    const state: RunState = createRun(`${base.initialRequest} (discovery ${i})`);
    state.requirements = structuredClone(req);
    state.phase = "discover";
    console.log(`--- Discovery ${i}/${n} (${state.id})`);
    await withIO(
      {
        ask: async () => {
          throw new Error("the stability test can't answer questions");
        },
        emit: (e) => {
          if (e.type === "log" && (e.level === "warn" || e.level === "ok")) printEvent(e);
        },
        trace: (e) => logEvent(state, e),
        state,
      },
      () => discoverPhase(state),
    );
    runs.push({
      found: state.candidates.map((c) => c.name),
      searches: state.discovery?.searches ?? 0,
      gaps: state.discovery?.gaps,
      ruledOut: (state.discovery?.brandsRuledOut ?? []).map((b) => `${b.brand} (${b.reason})`),
    });
  }

  // Group names that refer to the same product across runs.
  const groups: string[][] = [];
  for (const r of runs) for (const name of r.found) {
    const g = groups.find((g) => same(g[0], name));
    if (g) g.push(name);
    else groups.push([name]);
  }
  const inRuns = (g: string[]) => runs.filter((r) => r.found.some((f) => g.some((x) => same(x, f)))).length;
  const always = groups.filter((g) => inRuns(g) === runs.length).length;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const recallOf = (found: string[]) => (expected.length ? expected.filter((e) => found.some((f) => same(e, f))).length / expected.length : NaN);
  const union = runs.flatMap((r) => r.found);

  const lines = [
    `# Discovery stability: ${base.initialRequest}`,
    "",
    `${runs.length} independent discoveries, no earlier research reused.`,
    "",
    "| | |",
    "|---|---|",
    `| Products found in every run | ${always} of ${groups.length} distinct (${pct(always / Math.max(1, groups.length))}) |`,
    `| Products per run | ${runs.map((r) => r.found.length).join(", ")} |`,
    `| Searches per run | ${runs.map((r) => r.searches).join(", ")} |`,
    ...(expected.length
      ? [
          `| Recall per run (expected products found) | ${runs.map((r) => pct(recallOf(r.found))).join(", ")} |`,
          `| Recall of all runs together | ${pct(recallOf(union))} |`,
        ]
      : ["| Recall | no expected list: pass --expect \"A; B\" or add knowledge/<category>/expected.txt |"]),
    "",
    "## How often each product came up",
    "",
    "| Product | Runs |",
    "|---|---|",
    ...groups.sort((a, b) => inRuns(b) - inRuns(a)).map((g) => `| ${g[0]} | ${inRuns(g)}/${runs.length} |`),
    ...(expected.length
      ? ["", "## Expected products", "", ...expected.map((e) => `- ${e}: found in ${runs.filter((r) => r.found.some((f) => same(e, f))).length}/${runs.length} runs`)]
      : []),
    "",
    "## Notes per run",
    "",
    ...runs.map((r, i) => `- Run ${i + 1}: ${r.gaps ? `gaps: ${r.gaps}` : "full coverage"}${r.ruledOut.length ? `; brands ruled out: ${r.ruledOut.join("; ")}` : ""}`),
    "",
    "How to read this: products found in only some runs are where discovery is unstable. An expected product found in no run is a miss",
    "worth investigating: which angle should have surfaced it (retailer list, recent launches, owner threads)?",
  ];
  writeFileSync(join(outDir, "stability.md"), lines.join("\n") + "\n");
  console.log("\n" + lines.slice(4, 12).join("\n"));
  console.log(`\nFull report: ${join(outDir, "stability.md")}`);
}
