/**
 * Phase 5: Score.
 *
 * Earlier versions asked the model to score each product on its own. That
 * drifts: a flagship's reviews are critical ("overexposes sometimes"), a
 * mid-ranger's are glowing ("great for the price"), so the cheaper phone
 * scored higher on camera than a better one. Now each criterion score has
 * two parts:
 *
 *   1. Measurements (when available): numbers like a lab camera score,
 *      mapped onto 0-10 by code with a fixed scale per category.
 *   2. Side-by-side judgement: the judge model sees ALL products for ONE
 *      criterion at once (with their measurements and findings) and scores
 *      them relative to each other.
 *
 *   final = METRIC_WEIGHT x measurement score + rest x judged score
 *           (judged score only, when no measurement was found)
 *
 * Confidence is computed by code from measurement coverage and how much
 * independent evidence there is, not reported by the model.
 * Must-haves and dealbreakers are judged per product, separately.
 * Totals, budget and hard filters are applied in code (applyHardFilters).
 */
import { config } from "../config.ts";
import { log, throwIfStopped } from "../context.ts";
import { evidenceBlock, requirementsBlock } from "../format.ts";
import { chatJSON } from "../llm.ts";
import { metricScoreFor } from "../metrics.ts";
import { budgetLimit, budgetVerdict, bestPrice, formatMoney } from "../pricing.ts";
import { computeTotal, eligible, rank } from "../scoring.ts";
import { evidenceFor, saveState, type Candidate, type RunState, type Score } from "../state.ts";

const round1 = (x: number) => Math.round(x * 10) / 10;

type RulesJSON = {
  must_haves: { item: string; met: "yes" | "no" | "unknown"; evidence_ids: string[] }[];
  dealbreakers_hit: { item: string; evidence_ids: string[] }[];
};

type CompareJSON = { scores: { product: string; score: number; rationale: string }[] };

/** Confidence from data, not from the model's opinion of itself. */
export function computeConfidence(coverage: number, planned: number, findings: number, sourceTypes: number): Score["confidence"] {
  if ((planned > 0 && coverage >= 0.99) || (findings >= 3 && sourceTypes >= 2)) return "high";
  if (coverage > 0 || findings >= 2) return "medium";
  return "low";
}

/** Combine measurement and judgement into the final 0-10. */
export function combineScores(metricScore: number | undefined, judgedScore: number): number {
  if (metricScore === undefined) return round1(judgedScore);
  const w = config.scoring.metricWeight;
  return round1(w * metricScore + (1 - w) * judgedScore);
}

export async function scorePhase(state: RunState) {
  const req = state.requirements!;
  const shortlist = state.candidates.filter((c) => c.status === "shortlist");
  const anyChange = shortlist.some((c) => c.dirty || !c.scores);

  if (anyChange) {
    // 1. Must-haves and dealbreakers, per product that changed.
    for (const c of shortlist.filter((x) => x.dirty || !x.scores)) {
      throwIfStopped();
      await judgeRules(state, c);
    }

    // 2. Each criterion, all products side by side. Products are compared
    //    together, so any change means re-comparing everyone.
    const judged = new Map<string, Map<string, { score: number; rationale: string; spread: number }>>();
    for (const cr of req.criteria) {
      throwIfStopped();
      log(`Comparing all products on "${cr.name}" (${Math.max(1, config.scoring.judgeSamples)} passes, products in a different order each time)`);
      judged.set(cr.name, await compareOnCriterion(state, shortlist, cr.name));
    }

    // 3. Combine with measurements, in code.
    for (const c of shortlist) {
      const ev = evidenceFor(state, c.name);
      c.scores = req.criteria.map((cr): Score => {
        const m = metricScoreFor(state, c.name, cr.name);
        const j = judged.get(cr.name)!.get(c.name) ?? { score: 5, rationale: "not compared", spread: 0 };
        const crEv = ev.filter((e) => e.criterion === cr.name);
        const cited = [...new Set(j.rationale.match(/\bE\d+\b/g) ?? [])].filter((id) => crEv.some((e) => e.id === id));
        return {
          criterion: cr.name,
          score: combineScores(m.score, j.score),
          metricScore: m.score,
          judgedScore: j.score,
          measured: m.measured,
          confidence: computeConfidence(m.coverage, m.planned, crEv.length, new Set(crEv.map((e) => e.sourceType)).size),
          evidenceIds: cited.length ? cited : crEv.map((e) => e.id),
          rationale: j.rationale,
        };
      });
      c.dirty = false;
    }
    saveState(state);
  }

  applyHardFilters(state);
  saveState(state);

  const leader = rank(state.candidates).find(eligible);
  if (leader) log(`Current leader: ${leader.name} (${leader.total}/100)`, "ok");

  if (state.rescoreOnly) {
    // After a brief edit: no new research rounds, just an updated report.
    state.rescoreOnly = false;
    state.phase = "report";
  } else {
    state.phase = "critique";
  }
}

async function judgeRules(state: RunState, c: Candidate) {
  const req = state.requirements!;
  const ev = evidenceFor(state, c.name);
  const validIds = new Set(ev.map((e) => e.id));
  if (!req.mustHaves.length && !req.dealbreakers.length) {
    c.ruleFails = [];
    return;
  }
  log(`Checking must-haves and dealbreakers: ${c.name}`);
  const result = await chatJSON<RulesJSON>(
    [
      {
        role: "system",
        content: `You check ONE product against a person's hard requirements, using ONLY the evidence provided. Reply in JSON.

Must-haves:
${req.mustHaves.map((m) => `- ${m}`).join("\n") || "(none)"}
Dealbreakers:
${req.dealbreakers.map((d) => `- ${d}`).join("\n") || "(none)"}

Rules: a must-have is "no" only if evidence clearly shows it isn't met; "unknown" if there's no evidence. List a dealbreaker only if evidence clearly shows it applies. Cite evidence ids.
JSON: {"must_haves":[{"item":"...","met":"yes|no|unknown","evidence_ids":[]}],"dealbreakers_hit":[{"item":"...","evidence_ids":["E3"]}]}`,
      },
      { role: "user", content: `Product: ${c.name}\n\nEvidence:\n${evidenceBlock(ev)}` },
    ],
    { profile: "judge", label: `Checking must-haves for ${c.name}`, validate: (v) => (Array.isArray(v?.must_haves) ? null : 'missing "must_haves" array') },
  );
  const failedMust = (result.must_haves ?? []).filter((m) => m.met === "no" && m.evidence_ids?.some((id) => validIds.has(id)));
  const hitDeal = (result.dealbreakers_hit ?? []).filter((d) => d.evidence_ids?.some((id) => validIds.has(id)));
  c.ruleFails = [...failedMust.map((m) => `fails must-have "${m.item}"`), ...hitDeal.map((d) => `dealbreaker "${d.item}"`)];
}

/** Reverse on odd samples, then rotate, so each sample starts with a different product. */
export function sampleOrder<T>(items: T[], sample: number): T[] {
  const base = sample % 2 ? [...items].reverse() : [...items];
  const k = sample % Math.max(base.length, 1);
  return [...base.slice(k), ...base.slice(0, k)];
}

const medianOf = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};

/**
 * Score every product on one criterion, side by side. Run JUDGE_SAMPLES times
 * with the products in different orders and take each product's median:
 * models favour whatever they read first, and a single call can wobble.
 */
async function compareOnCriterion(state: RunState, products: Candidate[], criterion: string) {
  const samples = Math.max(1, config.scoring.judgeSamples);
  const runs: Map<string, { score: number; rationale: string }>[] = [];
  for (let i = 0; i < samples; i++) {
    throwIfStopped();
    runs.push(await compareOnce(state, sampleOrder(products, i), criterion));
  }
  return new Map(
    products.map((c) => {
      const all = runs.map((r) => r.get(c.name)!);
      const med = round1(medianOf(all.map((x) => x.score)));
      const closest = all.reduce((best, x) => (Math.abs(x.score - med) < Math.abs(best.score - med) ? x : best), all[0]);
      const spread = Math.max(...all.map((x) => x.score)) - Math.min(...all.map((x) => x.score));
      return [c.name, { score: med, rationale: closest.rationale, spread }];
    }),
  );
}

async function compareOnce(state: RunState, products: Candidate[], criterion: string) {
  const req = state.requirements!;
  const cr = req.criteria.find((c) => c.name === criterion)!;
  // Products are referred to by id (P1, P2...), not by name. Models "correct" names,
  // e.g. a user-typed "sumsung buds 2 pro" comes back as "samsung buds 2 pro",
  // and a name mismatch used to stop the run.
  const ids = new Map(products.map((c, i) => [`P${i + 1}`, c.name]));
  const pick = (scores: any[], c: Candidate) => {
    const id = [...ids].find(([, name]) => name === c.name)![0];
    return scores.find((x) => String(x?.id ?? "").trim().toUpperCase() === id) ?? findScore(scores, c.name);
  };
  const blocks = products.map((c, i) => {
    const m = metricScoreFor(state, c.name, criterion);
    const measured = m.measured.length ? m.measured.map((x) => `${x.label}: ${x.value} ${x.unit}${x.confirmed ? "" : " (single source)"}`).join("; ") : "none found";
    const ev = evidenceFor(state, c.name).filter((e) => e.criterion === criterion);
    return `### P${i + 1}: ${c.name}\nMeasurements: ${measured}\nFindings:\n${evidenceBlock(ev)}`;
  });

  const result = await chatJSON<CompareJSON>(
    [
      {
        role: "system",
        content: `You compare products on ONE criterion for ONE person. Reply in JSON.

Person and requirements:
${requirementsBlock(req, { rules: false })}

Criterion: ${cr.name}. What good means for this person: ${cr.description}

How to score (0-10, half points allowed):
- Compare the products WITH EACH OTHER. If A is clearly better than B on this criterion, A must score higher; similar products get similar scores.
- Measurements are objective and measured the same way for each product: when they exist, they outweigh the tone of reviews. Reviews of expensive products are often harsher because expectations are higher; don't let that make a better product score lower.
- Anchor the scale to the category, not to this list: 10 = among the best available today, 5 = average, 2 = clearly weak.
- Use only the findings and measurements given. With little evidence, stay near 5.
- Rationale: one sentence, citing evidence ids like E12.

JSON, one entry per product, using its id from the heading: {"scores":[{"id":"P1","product":"<name>","score":0,"rationale":"..."}]}`,
      },
      { role: "user", content: blocks.join("\n\n") },
    ],
    {
      profile: "judge",
      label: `Comparing on ${criterion}`,
      validate: (v) => {
        if (!Array.isArray(v?.scores)) return 'missing "scores" array';
        for (const c of products) {
          const s = pick(v.scores, c);
          if (!s) return `missing score for ${[...ids].find(([, n]) => n === c.name)![0]} (${c.name}); include its "id"`;
          if (!Number.isFinite(Number(s.score)) || Number(s.score) < 0 || Number(s.score) > 10) return `score for "${c.name}" must be a number 0-10`;
        }
        return null;
      },
    },
  );
  return new Map(products.map((c) => {
    const s = pick(result.scores, c);
    return [c.name, { score: round1(Number(s.score)), rationale: String(s.rationale ?? "") }];
  }));
}

/** Models often tweak names slightly ("Galaxy S25 FE" vs "Samsung Galaxy S25 FE 5G"): match exact first, then loosely. */
const nameKey = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
export function findScore<T extends { product?: unknown }>(scores: T[], name: string): T | undefined {
  const key = nameKey(name);
  return (
    scores.find((x) => x?.product === name) ??
    scores.find((x) => nameKey(x?.product) === key) ??
    // Only accept a containment match when it's unambiguous.
    ((m) => (m.length === 1 ? m[0] : undefined))(scores.filter((x) => { const k = nameKey(x?.product); return k.length > 3 && (k.includes(key) || key.includes(k)); }))
  );
}

/**
 * Totals and hard filters, computed in code from what's already known:
 * weighted totals from the scores, must-have/dealbreaker fails from the last
 * judgement, and the budget check (applied to every shortlisted product,
 * including ones the critic added) from recorded prices.
 * Re-running this is free, which is why weight and budget edits are instant.
 */
export function applyHardFilters(state: RunState) {
  const req = state.requirements!;
  const limit = budgetLimit(req);
  for (const c of state.candidates.filter((x) => x.status === "shortlist")) {
    // Older runs stored only the combined text; recover the rule part from it.
    c.ruleFails ??= c.disqualified ? c.disqualified.split("; ").filter((r) => !r.startsWith("over budget")) : [];
    if (c.scores) c.total = computeTotal(req, c.scores);
    c.bestPrice = bestPrice(state, c.name);
    const reasons = [...c.ruleFails];
    if (budgetVerdict(req, c.bestPrice) === "over" && c.bestPrice) {
      reasons.push(`over budget: lowest current price ${formatMoney(c.bestPrice.amount, c.bestPrice.currency)} at ${c.bestPrice.seller} (limit ${formatMoney(limit, req.budget.currency)})`);
    }
    c.disqualified = reasons.length ? reasons.join("; ") : undefined;
  }
}
