/**
 * Phase 4: Deep research, one candidate at a time.
 *
 * Harness ideas:
 *  - Fresh context per candidate (a "subagent"). Research on product A never
 *    pollutes the context for product B, and each run stays small.
 *  - Findings, MEASUREMENTS and prices are recorded as structured data with
 *    sources. Scoring works from these records, not the model's memory.
 *  - The finish gate enforces coverage: enough findings, several sites, an
 *    owner/community source, every criterion touched, a seller price, and at
 *    least half of the planned measurements.
 *  - Every finding, measurement and price carries a short QUOTE that code checks
 *    against the page actually fetched. Paraphrased or invented details fail.
 *  - Measurements count as confirmed only from the authoritative site or when
 *    two independent sites agree; disagreements must be resolved.
 *  - Earlier research on a product (knowledge/<category>/products) is carried
 *    in as dated evidence, but research still runs: it must add fresh findings
 *    and a current seller price, and check whether earlier findings still hold.
 *    Evidence accumulates across runs instead of being replayed.
 *  - Products researched much more thinly than the others get one top-up pass,
 *    so no product is scored from scraps.
 *  - If an agent runs out of steps before passing the gate it gets one retry;
 *    then the product is marked "incomplete" and can't be recommended.
 */
import { config } from "../config.ts";
import { log, throwIfStopped } from "../context.ts";
import { evidenceBlock, requirementsBlock } from "../format.ts";
import { domainBlock } from "../knowledge.ts";
import { ageDays, loadProduct, saveProduct } from "../library.ts";
import { finishTool, runAgent, tool } from "../loop.ts";
import { measuredValue, metricStatus, planMetrics } from "../metrics.ts";
import { budgetLimit, formatMoney, pricesFor } from "../pricing.ts";
import { evidenceFor, matchCriterion, saveState, type Candidate, type RunState, type SourceType } from "../state.ts";
import { makeWebTools, verifyQuote } from "../tools/web.ts";
import { domainOf } from "../util/html.ts";

const SOURCE_TYPES: SourceType[] = ["expert_review", "community", "spec", "retailer", "other"];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function researchPhase(state: RunState) {
  if (!state.metricPlan) await planMetrics(state);
  saveState(state);

  const queue = state.candidates.filter((c) => c.status === "shortlist" && (!c.researched || c.followups.length));
  for (const [i, c] of queue.entries()) {
    throwIfStopped();
    const followup = c.researched;
    log(`Researching ${i + 1}/${queue.length}: ${c.name}${followup ? " (follow-up)" : ""}`);

    // Carry in earlier research as dated evidence. Research still runs.
    if (!followup) importFromCache(state, c);

    let ok = await researchCandidate(state, c, false);
    if (!ok) {
      log(`${c.name}: research stopped before meeting the evidence bar; retrying once with a fresh agent`, "warn");
      ok = await researchCandidate(state, c, true);
    }
    if (!ok && !followup) {
      const n = evidenceFor(state, c.name).length;
      c.incomplete = `research couldn't gather enough evidence (${n} findings)`;
      log(`${c.name}: marked incomplete (${n} findings); it won't be recommended`, "warn");
    }
    finishCandidate(state, c, ok);
  }
  await balanceResearch(state);
  state.phase = "score";
}

/** Findings per product, excluding general notes (prices, availability). */
const substantive = (state: RunState, c: Candidate) => evidenceFor(state, c.name).filter((e) => e.criterion !== "general").length;

/**
 * Products researched much more thinly than the rest get one extra pass on
 * their weakest criteria, so scores don't come from a handful of findings.
 */
async function balanceResearch(state: RunState) {
  const req = state.requirements!;
  const pool = state.candidates.filter((c) => c.status === "shortlist" && c.researched && !c.incomplete);
  if (pool.length < 2) return;
  const counts = pool.map((c) => substantive(state, c)).sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)];
  for (const c of pool) {
    if (c.toppedUp || substantive(state, c) >= 0.6 * median) continue;
    throwIfStopped();
    const ev = evidenceFor(state, c.name);
    const weakest = [...req.criteria].sort((a, b) => ev.filter((e) => e.criterion === a.name).length - ev.filter((e) => e.criterion === b.name).length).slice(0, 2);
    c.toppedUp = true;
    c.followups = weakest.map((cr) => `Find more evidence on ${cr.name} (${cr.description}), especially owner reports and measurements.`);
    log(`${c.name}: researched more thinly than the others (${substantive(state, c)} vs typical ${median} findings); one more pass`, "warn");
    await researchCandidate(state, c, false);
    finishCandidate(state, c, true);
  }
}

function finishCandidate(state: RunState, c: Candidate, ok: boolean) {
  if (ok) c.incomplete = undefined;
  c.researched = true;
  c.followups = [];
  c.dirty = true;
  writeToCache(state, c);
  saveState(state);
}

// --- Cache ------------------------------------------------------------------------------------

/**
 * Carry in earlier findings and measurements on this product (marked with
 * their date). Prices are never reused: they're always checked fresh.
 */
export function importFromCache(state: RunState, c: Candidate): boolean {
  const req = state.requirements!;
  if (config.cache.researchDays <= 0) return false;
  const cached = loadProduct(req.category, c.name);
  if (!cached || ageDays(cached.updatedAt) > config.cache.researchDays) return false;
  const date = cached.updatedAt.slice(0, 10);
  const haveEvidence = new Set(evidenceFor(state, c.name).map((e) => norm(e.finding)));

  let n = 0;
  for (const e of cached.evidence) {
    if (haveEvidence.has(norm(e.finding))) continue;
    // Criteria names differ between runs; map by name, else keep it as general context.
    const criterion = matchCriterion(req, e.criterion) ?? "general";
    state.evidence.push({ ...e, id: `E${state.evidence.length + 1}`, candidate: c.name, criterion, round: state.round, cachedFrom: e.cachedFrom ?? date });
    n++;
  }
  state.metrics ??= [];
  for (const m of cached.metrics) {
    if (!state.metricDefs?.[m.key] || measuredValue(state, c.name, m.key) !== undefined) continue;
    state.metrics.push({ ...m, id: `M${state.metrics.length + 1}`, candidate: c.name, round: state.round, cachedFrom: m.cachedFrom ?? date });
    n++;
  }
  if (n) log(`${c.name}: carried in ${n} findings/measurements from research on ${date}; checking they still hold and adding fresh evidence`, "dim");
  return n > 0;
}

function writeToCache(state: RunState, c: Candidate) {
  const req = state.requirements!;
  const now = new Date().toISOString();
  const strip = <T extends { id: string; round: number }>({ id: _id, round: _round, ...rest }: T) => rest;
  saveProduct(req.category, {
    name: c.name,
    updatedAt: now,
    evidence: evidenceFor(state, c.name).map(strip),
    metrics: (state.metrics ?? []).filter((m) => norm(m.candidate) === norm(c.name)).map(strip),
    prices: pricesFor(state, c.name).map((p) => ({ ...strip(p), seenAt: p.cachedFrom ? new Date(p.cachedFrom).toISOString() : now })),
  });
}

/** A recorded number must appear in its quote, and the quote on the page (or its search result). */
function checkNumberQuote(url: string, quote: string, value: number): string | null {
  const digits = quote.replace(/[,\s]/g, "");
  const plain = String(value);
  if (!digits.includes(plain) && !digits.includes(plain.replace(".", ","))) return `ERROR: the quote must contain the number ${plain} as shown on the page.`;
  const check = verifyQuote(url, quote, { allowSnippet: true });
  if (check === "not-fetched") return "ERROR: that URL wasn't opened or seen in search results; open it with fetch_page first.";
  if (check === "not-found") return "ERROR: that quote isn't on the page or its search result. Copy the text exactly.";
  return null;
}

// --- Coverage and the finish gate -------------------------------------------------------------------

function coverage(state: RunState, c: Candidate) {
  const req = state.requirements!;
  const ev = evidenceFor(state, c.name);
  const perCriterion = req.criteria.map((cr) => ({ name: cr.name, count: ev.filter((e) => e.criterion === cr.name).length }));
  const sites = new Set(ev.map((e) => domainOf(e.sourceUrl)).filter(Boolean));
  const community = ev.filter((e) => e.sourceType === "community").length;
  const prices = pricesFor(state, c.name);
  const sellerPrices = prices.filter((p) => p.sourceType !== "article").length;
  const planned = [...new Set((state.metricPlan ?? []).flatMap((p) => p.keys))];
  const statuses = planned.map((k) => ({ key: k, ...metricStatus(state, c.name, k) }));
  const measured = statuses.filter((s) => s.value !== undefined).map((s) => s.key);
  const confirmed = statuses.filter((s) => s.confirmed).map((s) => s.key);
  const conflicts = statuses.filter((s) => s.conflict);
  const fresh = ev.filter((e) => !e.cachedFrom).length;
  const carried = ev.length - fresh;
  const summary =
    `Coverage: ${perCriterion.map((p) => `${p.name}=${p.count}`).join(", ")} | total=${ev.length}${carried ? ` (${fresh} new this run)` : ""}, sites=${sites.size}, ` +
    `community=${community}, prices=${prices.length} (from sellers: ${sellerPrices}), measurements=${measured.length}/${planned.length} (confirmed: ${confirmed.length})`;
  return { ev, perCriterion, sites, community, prices, sellerPrices, planned, measured, confirmed, conflicts, statuses, fresh, carried, summary };
}

/** What's still missing before research on this product may finish. Empty = done. */
export function gateProblems(state: RunState, c: Candidate, isFollowup: boolean, evidenceBefore: number): string[] {
  const req = state.requirements!;
  const { minEvidence, minDistinctSites } = config.limits;
  const cov = coverage(state, c);
  const problems: string[] = [];
  if (isFollowup) {
    if (cov.ev.length - evidenceBefore < 2) problems.push("record at least 2 new findings that answer the follow-up questions");
    return problems;
  }
  if (cov.ev.length < minEvidence) problems.push(`only ${cov.ev.length} findings, need ${minEvidence}`);
  if (cov.sites.size < minDistinctSites) problems.push(`findings come from ${cov.sites.size} sites, need ${minDistinctSites}`);
  if (cov.community < 1) problems.push("no community/owner source yet (search '<product> reddit' or owner reviews)");
  const missing = cov.perCriterion.filter((p) => p.count === 0).map((p) => p.name);
  if (missing.length) problems.push(`no findings yet for: ${missing.join(", ")}`);
  if (cov.sellerPrices < 1) problems.push(`no current price from a seller in ${req.region} yet (check the official store and big local retailers, then record_price)`);
  const needed = Math.ceil(cov.planned.length / 2);
  if (cov.confirmed.length < needed) {
    const todo = cov.statuses
      .filter((s) => !s.confirmed)
      .map((s) => {
        const d = state.metricDefs?.[s.key];
        const where = d?.sourceDomain ? `${d.sourceDomain}, or two other independent sites` : `two independent sites (${d?.sourceHint ?? "?"})`;
        return s.value === undefined ? `${s.key}: not found yet (${where})` : `${s.key}: only one source so far, confirm via ${where}`;
      });
    problems.push(`${cov.confirmed.length} of ${cov.planned.length} measurements confirmed, need at least ${needed}. ${todo.join("; ")}`);
  }
  for (const s of cov.conflicts) problems.push(`${s.key}: ${s.conflict}. Find the authoritative value (the source's own page) and record it`);
  if (cov.carried > 0 && cov.fresh < config.cache.minFreshFindings) {
    problems.push(`earlier findings were carried in, but only ${cov.fresh} new findings this run; check they still hold and add at least ${config.cache.minFreshFindings} new ones (recent owner reports, current version)`);
  }
  return problems;
}

// --- The research agent ----------------------------------------------------------------------------

/** Returns true if the agent finished with the gate passed. */
async function researchCandidate(state: RunState, c: Candidate, isRetry: boolean): Promise<boolean> {
  const req = state.requirements!;
  const isFollowup = c.researched;
  const before = evidenceFor(state, c.name).length;
  const currency = req.budget.currency || "local currency";
  const defs = state.metricDefs ?? {};
  let rejections = 0;

  const recordEvidence = tool(
    "record_evidence",
    "Save ONE concrete finding about this product, with the URL of the page it came from.",
    {
      criterion: { type: "string", description: `One of: ${req.criteria.map((c) => c.name).join(", ")}, or "general" (availability, versions...)` },
      finding: { type: "string", description: "Specific and factual: numbers, conditions, who reported it. 1-3 sentences." },
      sentiment: { type: "string", enum: ["positive", "negative", "mixed", "neutral"] },
      source_url: { type: "string" },
      source_type: { type: "string", enum: SOURCE_TYPES, description: "community = Reddit/forums/owner reviews" },
      quote: { type: "string", description: "Copy 1-2 sentences VERBATIM from the page that support the finding. Checked against the page." },
    },
    ({ criterion, finding, sentiment, source_url, source_type, quote }) => {
      const crit = matchCriterion(req, String(criterion));
      if (!crit) return `ERROR: criterion must be one of: ${req.criteria.map((c) => c.name).join(", ")}, or "general".`;
      if (!/^https?:\/\//.test(String(source_url))) return "ERROR: source_url must be the http(s) URL of the page you read.";
      const check = verifyQuote(String(source_url), String(quote ?? ""));
      if (check === "not-fetched") return "ERROR: open that page with fetch_page first; findings must come from pages you've read, not search snippets.";
      if (check === "not-found") return "ERROR: that quote isn't on the page. Copy the supporting text exactly (1-2 sentences), or don't record the finding.";
      state.evidence.push({
        id: `E${state.evidence.length + 1}`,
        candidate: c.name,
        criterion: crit,
        finding: String(finding),
        sentiment: ["positive", "negative", "mixed", "neutral"].includes(sentiment) ? sentiment : "neutral",
        sourceUrl: String(source_url),
        sourceType: SOURCE_TYPES.includes(source_type) ? source_type : "other",
        round: state.round,
        quote: String(quote).slice(0, 400),
      });
      c.dirty = true;
      saveState(state);
      return `Recorded ${state.evidence.at(-1)!.id} (quote verified). ${coverage(state, c).summary}`;
    },
  );

  const recordMetric = tool(
    "record_metric",
    "Save ONE measurement (a number) for this product. Only for the planned measurement keys.",
    {
      metric: { type: "string", enum: Object.keys(defs).length ? Object.keys(defs) : undefined, description: "Measurement key from the plan" },
      value: { type: "number", description: "The number only, in the unit of that measurement" },
      source_url: { type: "string" },
      quote: { type: "string", description: "The exact text from the page (or its search result) that shows the number" },
      note: { type: "string", description: "Optional: test conditions or variant (e.g. 'Exynos version')" },
    },
    ({ metric, value, source_url, note, quote }) => {
      const def = defs[String(metric)];
      if (!def) return `ERROR: unknown measurement "${metric}". Planned: ${Object.keys(defs).join(", ") || "(none)"}.`;
      const v = Number(String(value).replace(/[^0-9.\-]/g, ""));
      if (!Number.isFinite(v)) return "ERROR: value must be a number.";
      if (!/^https?:\/\//.test(String(source_url))) return "ERROR: source_url must be the page where you saw it.";
      const err = checkNumberQuote(String(source_url), String(quote ?? ""), v);
      if (err) return err;
      state.metrics ??= [];
      state.metrics.push({
        id: `M${state.metrics.length + 1}`,
        candidate: c.name,
        key: def.key,
        value: v,
        sourceUrl: String(source_url),
        note: note ? String(note) : undefined,
        round: state.round,
        quote: String(quote).slice(0, 300),
      });
      c.dirty = true;
      saveState(state);
      const st = metricStatus(state, c.name, def.key);
      const status = st.confirmed ? "confirmed" : st.conflict ? `CONFLICT (${st.conflict})` : "needs a second independent source or the authoritative site to be confirmed";
      return `Recorded ${def.label}: ${v} ${def.unit} (${status}). ${coverage(state, c).summary}`;
    },
    ["metric", "value", "source_url", "quote"],
  );

  const recordPrice = tool(
    "record_price",
    `Save ONE price you saw for this product. Record every price you come across, including list/MRP prices and prices quoted in articles: code decides which to trust.`,
    {
      amount: { type: "number", description: "Number only, e.g. 44999" },
      currency: { type: "string", description: `ISO code, e.g. ${currency}` },
      kind: { type: "string", enum: ["sale", "list", "offer"], description: "sale = price you'd pay today; list = MRP/launch price; offer = needs a bank card, coupon or exchange" },
      seller: { type: "string", description: "Store or site name" },
      url: { type: "string" },
      source_type: {
        type: "string",
        enum: ["official", "retailer", "article"],
        description: "official/retailer ONLY if you saw it on that seller's own product page (or its search snippet clearly showing the seller's current price). Prices quoted in reviews, listicles or news are 'article'.",
      },
      quote: { type: "string", description: "The exact text from the page (or its search result) that shows the price" },
    },
    ({ amount, currency: cur, kind, seller, url, source_type, quote }) => {
      const value = Number(String(amount).replace(/[^0-9.]/g, ""));
      if (!value || value <= 0) return "ERROR: amount must be a positive number.";
      if (!/^https?:\/\//.test(String(url))) return "ERROR: url must be the page where you saw the price.";
      const err = checkNumberQuote(String(url), String(quote ?? ""), value);
      if (err) return err;
      state.prices ??= [];
      const obs = {
        id: `P${state.prices.length + 1}`,
        candidate: c.name,
        amount: value,
        currency: String(cur || currency).toUpperCase(),
        kind: (["sale", "list", "offer"].includes(kind) ? kind : "sale") as "sale" | "list" | "offer",
        seller: String(seller || domainOf(String(url))),
        url: String(url),
        sourceType: (["official", "retailer", "article"].includes(source_type) ? source_type : "article") as "official" | "retailer" | "article",
        round: state.round,
        quote: String(quote).slice(0, 300),
      };
      state.prices.push(obs);
      c.dirty = true;
      saveState(state);
      return `Recorded ${obs.id}: ${formatMoney(obs.amount, obs.currency)} (${obs.kind}, ${obs.sourceType}). ${coverage(state, c).summary}`;
    },
  );

  const finish = finishTool(
    "finish_research",
    "Call when research on this product is complete.",
    {
      summary: { type: "string", description: "2-3 sentence summary of what you learned" },
      insufficient_reason: { type: "string", description: "Only if asked: why some coverage genuinely can't be found" },
    },
    ({ summary, insufficient_reason }) => {
      const problems = gateProblems(state, c, isFollowup, before);
      if (!problems.length) {
        if (summary) c.notes.push(`Round ${state.round}: ${summary}`);
        return null;
      }
      rejections++;
      // Escape hatch: after repeated rejections, allow finishing if the model
      // explains the gap. Recorded so scoring treats it as low confidence.
      if (rejections > 2 && insufficient_reason) {
        c.notes.push(`Research gap (round ${state.round}): ${insufficient_reason}`);
        return null;
      }
      const hint = rejections >= 2 ? " If this genuinely can't be found, call finish_research with insufficient_reason." : "";
      return `${problems.join("; ")}.${hint}`;
    },
    ["summary"],
  );

  const existing = evidenceFor(state, c.name);
  const limit = budgetLimit(req);
  const budgetLine = limit === Infinity ? "" : `\nBudget limit: ${formatMoney(limit, currency)}. A verified seller price above that rules the product out, so get the CURRENT price right.`;
  const retryNote = isRetry ? `\nA previous attempt ran out of steps. Be efficient: fewer searches, open the most promising pages, and record findings as you go.\n` : "";
  const known = existing.length ? `\n\nAlready recorded (don't repeat; focus on what's missing):\n${evidenceBlock(existing)}\n${coverage(state, c).summary}` : "";
  const task = isFollowup
    ? `Follow-up research on "${c.name}". Answer these open questions with new evidence:\n${c.followups.map((q) => `- ${q}`).join("\n")}\n\nEvidence already recorded (don't repeat it):\n${evidenceBlock(existing)}${retryNote}`
    : `Research "${c.name}" for this person. It was considered because: ${c.whyConsidered}${budgetLine}${known}${
        coverage(state, c).carried ? `\n\nSome findings above come from earlier research (marked with a date). Check they still hold for the current version, and record anything that contradicts them as a new finding that says so.` : ""
      }${retryNote}`;

  const metricList = Object.values(defs);
  const metricsText = metricList.length
    ? `\nMeasurements to find (record each with record_metric; these drive the scores, so they matter most):
${metricList.map((d) => `- ${d.key}: ${d.label} in ${d.unit}. Source: ${d.sourceHint}`).join("\n")}
Use the named source whenever it has the product, so every product is measured the same way. Make sure it's the right model and variant. If a product isn't covered by that source, skip that measurement rather than substituting a different kind of number.`
    : "";

  const system = `You are a meticulous product researcher investigating ONE product for ONE specific person.

Person and requirements:
${requirementsBlock(req)}
${domainBlock(req.category)}
How to research:
- Find what expert testers AND real owners say, focused on this person's criteria, must-haves and dealbreakers.
- Good sources: hands-on or lab reviews, Reddit/forum threads from owners (long-term durability, problems, sizing), official specs, sellers in ${req.region} for real price and availability.
- Distrust thin affiliate listicles. Check you're reading about the right model/version, since names are often similar across generations.
- Open pages with fetch_page; search snippets are not evidence.
- Record each concrete finding with record_evidence: specific facts (numbers, conditions, who said it), not vague praise. Record negatives as carefully as positives.
- Every finding, measurement and price needs a VERBATIM quote from its source; code checks it against the page. Only record what the page actually says.
- Prices: check the CURRENT price at the official store and big retailers in ${req.region} (search e.g. "<product> price ${req.region}" and open seller pages). Record every price with record_price. Prices in articles and launch coverage are often months old; record them as "article", never as the current price.${metricsText}
- When coverage is good, call finish_research.`;

  const result = await runAgent({
    label: c.name.slice(0, 28),
    system,
    task,
    tools: [...makeWebTools(), recordEvidence, recordMetric, recordPrice],
    finish,
    maxSteps: config.limits.steps.research,
  });
  saveState(state);
  return result.finished;
}
