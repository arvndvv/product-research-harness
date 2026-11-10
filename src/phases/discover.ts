/**
 * Phase 2: Discover (agent) and Phase 3: Shortlist (single structured call).
 *
 * Discover is open-ended, so it's an agent loop with tools. Shortlisting is a
 * single judgement over known data, so it's one JSON call. Use an agent only
 * where the path is genuinely unknown.
 */
import { log } from "../context.ts";
import { config } from "../config.ts";
import { requirementsBlock } from "../format.ts";
import { domainBlock } from "../knowledge.ts";
import { budgetLimit, formatMoney } from "../pricing.ts";
import { ageDays, loadSeen } from "../library.ts";
import { chatJSON } from "../llm.ts";
import { finishTool, runAgent, tool } from "../loop.ts";
import { findCandidate, newCandidate, saveState, type RunState } from "../state.ts";
import { makeWebTools } from "../tools/web.ts";
import { domainOf } from "../util/html.ts";

export async function discoverPhase(state: RunState) {
  const req = state.requirements!;
  const { minLonglist, minDistinctSites } = config.limits;
  const year = new Date().getFullYear();
  const limit = budgetLimit(req);
  const stretchPct = config.limits.priceToVerifyPercent;
  const budgetRule =
    limit === Infinity
      ? ""
      : `- Budget limit is ${formatMoney(limit, req.budget.currency)}. Prices in articles and search snippets are often launch/list prices from months ago, and actual selling prices are frequently much lower. So DON'T skip a strong product just because an article lists it up to ${stretchPct}% over budget: add it and say "price to verify" in approx_price. Skip only products clearly far above budget.
- Actively look for previous-generation premium models that are now discounted into the budget (they often beat current mid-range models), e.g. search "<category> under <budget> ${req.region}" on retailer sites and recent price-drop news.`;

  // Products from earlier research in this category: re-checking them first
  // makes repeated runs land on a stable candidate set.
  const seen = loadSeen(req.category).filter((s) => ageDays(s.lastSeen) <= 60).slice(0, 15);
  const seenBlock = seen.length
    ? `\nProducts considered in earlier research in this category (re-check them: add the ones that still fit THIS person's requirements, then look for anything newer or missed):\n${seen
        .map((s) => `- ${s.name} (${s.outcome}${s.price ? `, ${s.price}` : ""}, ${s.lastSeen.slice(0, 10)})`)
        .join("\n")}\n`
    : "";

  const addCandidate = tool(
    "add_candidate",
    "Add one specific product (exact model/version name) to the longlist.",
    {
      name: { type: "string", description: "Exact product name incl. model/version, e.g. 'Brand Model 4'" },
      approx_price: { type: "string", description: "Approximate price in the user's region if seen, else empty" },
      why: { type: "string", description: "Why it might fit THIS person" },
      source_url: { type: "string", description: "Page where you saw it recommended" },
    },
    ({ name, approx_price, why, source_url }) => {
      const n = String(name).trim();
      if (!n) return "ERROR: name is empty";
      if (findCandidate(state, n)) return `Already on the list: ${n}`;
      state.candidates.push(
        newCandidate({ name: n, price: String(approx_price ?? ""), whyConsidered: String(why ?? ""), source: String(source_url ?? ""), status: "longlist", round: state.round }),
      );
      saveState(state);
      return `Added. Longlist (${state.candidates.length}): ${state.candidates.map((c) => c.name).join("; ")}`;
    },
  );

  const finish = finishTool("finish_longlist", "Call when the longlist is complete.", { notes: { type: "string" } }, () => {
    const n = state.candidates.length;
    const sites = new Set(state.candidates.map((c) => domainOf(c.source)).filter(Boolean));
    if (n < minLonglist) return `only ${n} candidates; find at least ${minLonglist}.`;
    if (sites.size < minDistinctSites)
      return `candidates come from only ${sites.size} distinct sites; widen your sources (expert reviews, Reddit/forums, retailers in ${req.region}).`;
    return null;
  });

  const system = `You are building a LONGLIST of real products for one specific person. Later steps research them in depth, so aim for coverage and good candidates, not a final answer.

Person and requirements:
${requirementsBlock(req)}
${domainBlock(req.category)}${seenBlock}
How to search like a careful human, not like a listicle:
- Use several angles: expert "best of ${year}" roundups, Reddit/forum threads where people with SIMILAR needs ask for recommendations, specialist review sites, and retailers in ${req.region} to confirm the products are actually sold there.
- Include options enthusiasts recommend for this exact use case, not only the most-advertised top picks.
- Use exact current model names and versions. Avoid discontinued models unless still widely sold in ${req.region}.
- Skip products that clearly break a dealbreaker or must-have.
${budgetRule}
- Add products with add_candidate as you find them (aim for ${minLonglist}-12). Then call finish_longlist.`;

  const result = await runAgent({
    label: "discover",
    system,
    task: `Build the longlist for: ${req.summary}`,
    tools: [...makeWebTools(15), addCandidate],
    finish,
    maxSteps: config.limits.steps.discover,
  });
  if (!result.finished && state.candidates.length < 2) throw new Error("Discovery found too few candidates.");
  state.phase = "shortlist";
}

type ShortlistJSON = { shortlist: { name: string; reason: string }[]; cut: { name: string; reason: string }[] };

export async function shortlistPhase(state: RunState) {
  const req = state.requirements!;
  const max = config.limits.maxShortlist;
  const longlist = state.candidates.filter((c) => c.status === "longlist");

  const result = await chatJSON<ShortlistJSON>(
    [
      {
        role: "system",
        content: `You pick which products deserve in-depth research for this person. Reply in JSON.

Person and requirements:
${requirementsBlock(req)}

Rules:
- Choose at most ${max} for the shortlist.
- Cut anything that likely violates a must-have or dealbreaker, or isn't sold in ${req.region}.
- Price: the prices listed are rough and often outdated list prices; research will check current seller prices and code enforces the budget. Cut for price only if it's clearly far above the budget. Keep strong "price to verify" options (often discounted premium models), they may be the best value.
- Don't score products here and don't invent numbers; judge from what's listed.
- Prefer variety: if several are near-identical, keep the most promising one so research covers different trade-offs.
- Every longlist product must appear in either "shortlist" or "cut", using its exact name.

JSON format: {"shortlist":[{"name":"...","reason":"..."}],"cut":[{"name":"...","reason":"..."}]}`,
      },
      {
        role: "user",
        content: longlist.map((c) => `- ${c.name} | price: ${c.price || "?"} | why: ${c.whyConsidered}`).join("\n"),
      },
    ],
    {
      profile: "judge",
      validate: (v) => {
        if (!Array.isArray(v?.shortlist) || !v.shortlist.length) return "shortlist must be a non-empty array";
        if (v.shortlist.length > max) return `shortlist has ${v.shortlist.length} items, max is ${max}`;
        const unknown = v.shortlist.filter((s: any) => !findCandidate(state, String(s.name)));
        if (unknown.length) return `unknown names: ${unknown.map((s: any) => s.name).join(", ")}; use exact longlist names`;
        return null;
      },
    },
  );

  const keep = new Map(result.shortlist.map((s) => [findCandidate(state, s.name)!, s.reason]));
  const cutReasons = new Map((result.cut ?? []).map((c) => [findCandidate(state, c.name), c.reason]));
  for (const c of longlist) {
    if (keep.has(c)) {
      c.status = "shortlist";
      c.notes.push(`Shortlisted: ${keep.get(c)}`);
    } else {
      c.status = "cut";
      c.cutReason = cutReasons.get(c) ?? "not selected for the shortlist";
    }
  }
  log(`Shortlist: ${[...keep.keys()].map((c) => c.name).join("; ")}`, "ok");
  state.phase = "research";
}
