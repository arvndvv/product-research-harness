/**
 * Phase 2: Discover (agent) and Phase 3: Shortlist (single structured call).
 *
 * Discover is open-ended, so it's an agent loop with tools. Shortlisting is a
 * single judgement over known data, so it's one JSON call. Use an agent only
 * where the path is genuinely unknown.
 */
import { ask, log } from "../context.ts";
import { config } from "../config.ts";
import { requirementsBlock } from "../format.ts";
import { domainBlock } from "../knowledge.ts";
import { budgetLimit, formatMoney } from "../pricing.ts";
import { ageDays, loadSeen } from "../library.ts";
import { chatJSON } from "../llm.ts";
import { finishTool, runAgent, tool } from "../loop.ts";
import { findCandidate, newCandidate, saveState, type RunState } from "../state.ts";
import { DISCOVERY_ANGLES, type DiscoveryAngle } from "../shared.ts";
import { makeWebTools } from "../tools/web.ts";
import { domainOf } from "../util/html.ts";

const ANGLE_HELP: Record<(typeof DISCOVERY_ANGLES)[number], string> = {
  expert_review: "an expert review site or \"best of\" roundup",
  community: "an owner/community discussion (Reddit, forums) where people with similar needs recommend products",
  retailer_list: "a retailer or comparison-site list filtered to the price range (e.g. a category page sorted or filtered by price)",
  new_launch: "recent launches (last ~6 months) in this category and region, so newer models aren't missed",
};

/** Lowercase letters and digits only, for loose brand/product matching. */
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Brands still unaccounted for: no product on the longlist and not ruled out with a reason. */
export function missingBrands(state: RunState): string[] {
  const d = state.discovery;
  if (!d) return [];
  const names = state.candidates.map((c) => key(c.name));
  const ruledOut = new Set(d.brandsRuledOut.filter((r) => r.reason.trim().length >= 8).map((r) => key(r.brand)));
  return d.brands.filter((b) => !ruledOut.has(key(b)) && !names.some((n) => n.includes(key(b))));
}

/** Angles no product was found through yet. */
export function missingAngles(state: RunState): (typeof DISCOVERY_ANGLES)[number][] {
  const seen = new Set(state.candidates.flatMap((c) => c.foundVia ?? []));
  return DISCOVERY_ANGLES.filter((a) => !seen.has(a));
}

/**
 * Everything that must hold before discovery may finish. Coverage is checked in
 * code, not by counting: every angle searched, every main brand accounted for,
 * and the search kept going until new searches stopped finding new products.
 */
export function discoveryProblems(state: RunState): string[] {
  const { minLonglist, minDistinctSites, discoverSaturation, maxLonglist } = config.limits;
  const d = state.discovery!;
  const problems: string[] = [];
  const n = state.candidates.length;
  const sites = new Set(state.candidates.map((c) => domainOf(c.source)).filter(Boolean));
  if (n < minLonglist) problems.push(`only ${n} products; find at least ${minLonglist}`);
  if (sites.size < minDistinctSites) problems.push(`products come from only ${sites.size} sites; widen your sources`);
  const angles = missingAngles(state);
  if (angles.length) problems.push(`no product found via: ${angles.map((a) => `${a} (${ANGLE_HELP[a]})`).join("; ")}`);
  const brands = missingBrands(state);
  if (brands.length)
    problems.push(`brands not accounted for: ${brands.join(", ")}. Add their best fit for this person, or list them in brands_ruled_out with a specific reason`);
  if (n < maxLonglist && d.searchesSinceNew < discoverSaturation)
    problems.push(
      `the search hasn't saturated: ${d.searchesSinceNew} of the last searches found nothing new, need ${discoverSaturation}. Try different angles (other retailers, "alternatives to <top product>", recent launches, owner threads) and add anything new`,
    );
  return problems;
}

type BrandsJSON = { brands: string[] };

/** The brands a careful shopper would check, as a checklist for discovery. One model call. */
async function marketBrands(state: RunState): Promise<string[]> {
  const req = state.requirements!;
  const limit = budgetLimit(req);
  const range = limit === Infinity ? "any price" : `up to about ${formatMoney(limit, req.budget.currency)}`;
  try {
    const r = await chatJSON<BrandsJSON>(
      [
        {
          role: "system",
          content: `List the brands that sell ${req.category} in ${req.region} at ${range} and that a careful shopper would compare. Include local and value brands popular in ${req.region}, not only global ones. Main brands only, at most 10. Brand names only. Reply in JSON: {"brands":["..."]}`,
        },
      ],
      { profile: "judge", label: "Listing brands", validate: (v) => (Array.isArray(v?.brands) && v.brands.length ? null : 'missing "brands" array') },
    );
    return [...new Set(r.brands.map((b) => String(b).trim()).filter((b) => b.length >= 2))].slice(0, 10);
  } catch (e) {
    log(`Couldn't list brands to check (${(e as Error).message}); discovery continues without the brand check`, "warn");
    return [];
  }
}

export async function discoverPhase(state: RunState) {
  if (!state.discovery?.agentDone) {
    const brands = state.discovery?.brands ?? (await marketBrands(state));
    state.discovery = { brands, brandsRuledOut: state.discovery?.brandsRuledOut ?? [], searches: 0, searchesSinceNew: 0 };
    if (brands.length) log(`Brands to check: ${brands.join(", ")}`);
    saveState(state);
    await runDiscovery(state);
    state.discovery.agentDone = true;
    saveState(state);
  }
  // The person sees the longlist before anything is cut: remove, add, or ask for more searching.
  if (config.limits.reviewLonglist) await reviewLonglist(state);
  state.phase = "shortlist";
}

/**
 * The discovery agent. First pass: full coverage gate. Follow-up pass (the
 * person asked to search for more): search for what they asked, then finish.
 */
async function runDiscovery(state: RunState, followup?: { hint: string }) {
  const req = state.requirements!;
  const { minLonglist, discoverSaturation, maxLonglist } = config.limits;
  const brands = state.discovery!.brands;
  const searchesBefore = state.discovery!.searches;
  const year = new Date().getFullYear();
  const limit = budgetLimit(req);
  const stretchPct = config.limits.priceToVerifyPercent;
  const budgetRule =
    limit === Infinity
      ? ""
      : `- Budget limit is ${formatMoney(limit, req.budget.currency)}. Prices in articles and search snippets are often launch/list prices from months ago, and actual selling prices are frequently much lower. So DON'T skip a strong product just because an article lists it up to ${stretchPct}% over budget: add it and say "price to verify" in approx_price. Skip only products clearly far above budget.
- Actively look for previous-generation premium models that are now discounted into the budget (they often beat current mid-range models).`;

  // Products from earlier research in this category: re-checked alongside new searching.
  const seen = loadSeen(req.category).filter((s) => ageDays(s.lastSeen) <= 60).slice(0, 15);
  const seenBlock = seen.length
    ? `\nProducts considered in earlier research in this category (re-check them: add the ones that still fit THIS person's requirements with found_via "earlier_research", then search for anything newer or missed):\n${seen
        .map((s) => `- ${s.name} (${s.outcome}${s.price ? `, ${s.price}` : ""}, ${s.lastSeen.slice(0, 10)})`)
        .join("\n")}\n`
    : "";

  const addCandidate = tool(
    "add_candidate",
    "Add one specific product (exact model/version name) to the longlist. If it's already there but you found it through another angle too, call it again with that found_via: it's recorded.",
    {
      name: { type: "string", description: "Exact product name incl. model/version, e.g. 'Brand Model 4'" },
      approx_price: { type: "string", description: "Approximate price in the user's region if seen, else empty" },
      why: { type: "string", description: "Why it might fit THIS person" },
      source_url: { type: "string", description: "Page where you saw it" },
      found_via: { type: "string", enum: [...DISCOVERY_ANGLES, "earlier_research", "other"], description: "What kind of source this was" },
    },
    ({ name, approx_price, why, source_url, found_via }) => {
      const n = String(name).trim();
      if (!n) return "ERROR: name is empty";
      const via = ([...DISCOVERY_ANGLES, "earlier_research", "other"] as string[]).includes(found_via) ? (found_via as DiscoveryAngle) : "other";
      const existing = findCandidate(state, n);
      if (existing) {
        if (!(existing.foundVia ?? []).includes(via)) {
          existing.foundVia = [...(existing.foundVia ?? []), via];
          saveState(state);
          return `Already on the list: ${existing.name}. Also noted as found via ${via}.`;
        }
        return `Already on the list: ${existing.name}`;
      }
      const c = newCandidate({ name: n, price: String(approx_price ?? ""), whyConsidered: String(why ?? ""), source: String(source_url ?? ""), status: "longlist", round: state.round });
      c.foundVia = [via];
      state.candidates.push(c);
      state.discovery!.searchesSinceNew = 0;
      saveState(state);
      const count = state.candidates.filter((x) => x.status === "longlist").length;
      if (!followup && count >= maxLonglist) {
        const open = discoveryProblems(state);
        return `Added (${count} products). The list is long enough: don't add more of the same kind.${open.length ? ` Still needed before finishing: ${open.join("; ")}.` : " Call finish_longlist."}`;
      }
      return `Added (${count} products). ${coverageLine(state)}`;
    },
  );

  // Count searches, so code can tell when new searches stop finding new products.
  // Product lists are long and every line matters, so discovery sees more of each page than research does.
  const web = makeWebTools(20, { maxChars: 6000 }).map((t) =>
    t.spec.function.name === "web_search"
      ? {
          ...t,
          run: async (args: any) => {
            const out = await t.run(args);
            state.discovery!.searches++;
            state.discovery!.searchesSinceNew++;
            return out;
          },
        }
      : t,
  );

  let rejections = 0;
  const finish = finishTool(
    "finish_longlist",
    "Call when the longlist is complete. Code checks coverage: every search angle, every listed brand, and that recent searches stopped finding new products.",
    {
      brands_ruled_out: {
        type: "array",
        description: "Brands from the checklist you deliberately left out, each with a specific reason (e.g. 'nothing under the budget in India')",
        items: { type: "object", properties: { brand: { type: "string" }, reason: { type: "string" } }, required: ["brand", "reason"] },
      },
      gaps: { type: "string", description: "Only after repeated rejections: what genuinely couldn't be covered and why" },
    },
    ({ brands_ruled_out, gaps }) => {
      for (const r of Array.isArray(brands_ruled_out) ? brands_ruled_out : []) {
        if (!r?.brand || !r?.reason) continue;
        const d = state.discovery!;
        d.brandsRuledOut = [...d.brandsRuledOut.filter((x) => key(x.brand) !== key(String(r.brand))), { brand: String(r.brand), reason: String(r.reason) }];
      }
      saveState(state);
      if (followup) return state.discovery!.searches - searchesBefore >= 2 ? null : "search for what the person asked first (at least 2 searches)";
      const problems = discoveryProblems(state);
      if (!problems.length) return null;
      rejections++;
      // Escape hatch, as in research: after repeated rejections an explained gap is accepted and shown.
      if (rejections > 2 && typeof gaps === "string" && gaps.trim().length > 15 && state.candidates.length >= minLonglist) {
        state.discovery!.gaps = gaps.trim();
        log(`Discovery finished with gaps: ${gaps.trim()}`, "warn");
        return null;
      }
      const hint = rejections >= 2 ? " If something genuinely can't be covered, call finish_longlist again with gaps explaining it." : "";
      return `${problems.join("; ")}.${hint}`;
    },
    [],
  );

  const system = `You are building a LONGLIST of real products for one specific person. Later steps research them in depth, so aim for COVERAGE: don't miss a product this person should consider. It is not a final answer.

Person and requirements:
${requirementsBlock(req)}
${domainBlock(req.category)}${seenBlock}
Search every angle (code checks each one before you may finish):
${DISCOVERY_ANGLES.map((a) => `- ${a}: ${ANGLE_HELP[a]}`).join("\n")}
${brands.length ? `\nBrand checklist (account for every one: add its best fit for this person, or rule it out with a reason when finishing): ${brands.join(", ")}\n` : ""}
How to search like a careful human, not like a listicle:
- Start with the catalogue: retailer and comparison-site lists for this category in ${req.region} within the price range show what's actually on sale. Use them to find names, not prices (listings mix in accessories and copies).
- Then expert "best of ${year}" roundups, and Reddit/forum threads where people with SIMILAR needs ask for recommendations.
- Include what enthusiasts recommend for this exact use case, not only the most-advertised picks.
- Name = brand + model (+ generation or year), e.g. "Lenovo IdeaPad Slim 5 (2025)". Put the configuration (CPU, RAM, storage) in "why", not in the name, and add each model once with the configuration that fits this person best.
- Use exact current model names and versions. Avoid discontinued models unless still widely sold in ${req.region}.
- Skip products that clearly break a dealbreaker or must-have.
${budgetRule}
- Add products with add_candidate as you find them, with found_via set honestly. When a product shows up again from a different angle, add it again with that found_via.
- Keep searching until ${discoverSaturation} searches in a row turn up nothing new (or the list reaches ${maxLonglist}). Then call finish_longlist.`;

  const current = state.candidates.filter((c) => c.status === "longlist").map((c) => `- ${c.name}`).join("\n");
  const result = await runAgent({
    label: "discover",
    system,
    task: followup
      ? `The person reviewed the longlist and asked you to search for more: "${followup.hint}"\n\nAlready on the list (don't add these again):\n${current}\n\nSearch for what they asked, add anything new that fits, then call finish_longlist.`
      : `Build the longlist for: ${req.summary}`,
    tools: [...web, addCandidate],
    finish,
    maxSteps: followup ? 20 : config.limits.steps.discover,
  });
  if (followup) {
    log(`Search for more finished; ${state.candidates.filter((c) => c.status === "longlist").length} products on the list`, "ok");
    return;
  }
  if (!result.finished && state.candidates.length < 2) throw new Error("Discovery found too few candidates.");
  if (!result.finished) {
    const open = discoveryProblems(state);
    if (open.length) state.discovery!.gaps = `Stopped before full coverage: ${open.join("; ")}`;
    log(`Discovery stopped before full coverage; continuing with ${state.candidates.length} products`, "warn");
  } else {
    log(`Longlist: ${state.candidates.length} products. ${coverageLine(state)}`, "ok");
  }
}

export type LonglistReview = { action: "continue" | "more"; remove: string[]; add: string[]; hint: string };

/**
 * The person's reply to the longlist review. The web app sends JSON; the command
 * line sends text: Enter to continue, or lines like "remove: X", "add: Y", "more: Z".
 */
export function parseLonglistReview(text: string): LonglistReview {
  const out: LonglistReview = { action: "continue", remove: [], add: [], hint: "" };
  const t = text.trim();
  try {
    const v = JSON.parse(t);
    if (v && typeof v === "object") {
      const list = (x: unknown) => (Array.isArray(x) ? x.map((s) => String(s).trim()).filter(Boolean) : []);
      return { action: v.action === "more" ? "more" : "continue", remove: list(v.remove), add: list(v.add), hint: String(v.hint ?? "").trim() };
    }
  } catch {
    /* plain text */
  }
  for (const line of t.split(/\r?\n|;/).map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^(remove|add|more)\s*:?\s*(.*)$/i);
    if (!m) continue;
    const [, cmd, rest] = m;
    if (/^remove$/i.test(cmd)) out.remove.push(...rest.split(",").map((s) => s.trim()).filter(Boolean));
    else if (/^add$/i.test(cmd)) out.add.push(...rest.split(",").map((s) => s.trim()).filter(Boolean));
    else {
      out.action = "more";
      out.hint = rest.trim();
    }
  }
  return out;
}

/** Apply removals and additions. Removed products are cut; added ones are always researched. */
export function applyLonglistReview(state: RunState, r: LonglistReview): string[] {
  const changes: string[] = [];
  for (const name of r.remove) {
    const c = findCandidate(state, name);
    if (!c || c.status !== "longlist") continue;
    c.status = "cut";
    c.cutReason = "Removed by you";
    changes.push(`removed ${c.name}`);
  }
  for (const raw of r.add) {
    const name = raw.replace(/\s+/g, " ").slice(0, 120);
    if (name.length < 2) continue;
    const existing = findCandidate(state, name);
    if (existing) {
      existing.status = "longlist";
      existing.addedByUser = true;
      existing.cutReason = undefined;
      changes.push(`kept ${existing.name}`);
      continue;
    }
    const c = newCandidate({ name, price: "", whyConsidered: "Added by you", source: "", status: "longlist", round: state.round });
    c.addedByUser = true;
    state.candidates.push(c);
    changes.push(`added ${name}`);
  }
  return changes;
}

/** Show the longlist and let the person remove, add, or ask for more searching (at most twice). */
async function reviewLonglist(state: RunState) {
  let searchesAsked = 0;
  for (;;) {
    const items = state.candidates.filter((c) => c.status === "longlist");
    const d = state.discovery!;
    const coverage = [
      `Found via: ${DISCOVERY_ANGLES.map((a) => `${a.replace("_", " ")} ${items.filter((c) => c.foundVia?.includes(a)).length}`).join(", ")}`,
      d.brands.length ? `Brands not covered: ${missingBrands(state).join(", ") || "none"}` : "",
      d.gaps ? `Gap: ${d.gaps}` : "",
    ].filter(Boolean);
    const answer = await ask(`Here are the ${items.length} products found. Remove any you don't want, add any that are missing, or ask for more searching. Then the best ${config.limits.maxShortlist} are picked for in-depth research (products you add are always researched).`, {
      longlist: items.map((c) => ({ name: c.name, price: c.price, why: c.whyConsidered, foundVia: c.foundVia ?? [], source: c.source, addedByUser: c.addedByUser })),
      details: [...items.map((c, i) => `${i + 1}. ${c.name}${c.price ? ` (${c.price})` : ""}`), "", ...coverage, "", "Press Enter to continue, or type lines like: remove: <name>, add: <name>, more: <what to look for>"].join("\n"),
    });
    const r = parseLonglistReview(answer);
    const changes = applyLonglistReview(state, r);
    if (changes.length) log(`Longlist: ${changes.join("; ")}`, "ok");
    saveState(state);
    if (r.action !== "more") return;
    if (searchesAsked >= 2) {
      log("Searched for more twice already; continuing with this list", "warn");
      return;
    }
    searchesAsked++;
    log(`Searching for more${r.hint ? `: ${r.hint}` : ""}`);
    await runDiscovery(state, { hint: r.hint || "anything good that's missing from the list" });
    saveState(state);
  }
}

/** One-line coverage summary, for the agent and the activity log. */
function coverageLine(state: RunState) {
  const d = state.discovery!;
  const angles = DISCOVERY_ANGLES.map((a) => `${a} ${state.candidates.filter((c) => c.foundVia?.includes(a)).length}`).join(", ");
  const brands = d.brands.length ? `; brands open: ${missingBrands(state).join(", ") || "none"}` : "";
  const missing = missingAngles(state);
  return `Found via: ${angles}${missing.length ? ` (still missing: ${missing.join(", ")})` : ""}${brands}; searches since last new product: ${d.searchesSinceNew}.`;
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
- "found via" shows which kinds of sources surfaced each product. Several angles = well established; one angle can still be a hidden gem, so judge on fit, not popularity.
- Every longlist product must appear in either "shortlist" or "cut", using its exact name.

JSON format: {"shortlist":[{"name":"...","reason":"..."}],"cut":[{"name":"...","reason":"..."}]}`,
      },
      {
        role: "user",
        content: longlist.map((c) => `- ${c.name} | price: ${c.price || "?"} | found via: ${(c.foundVia ?? []).join(", ") || "?"} | why: ${c.whyConsidered}`).join("\n"),
      },
    ],
    {
      profile: "judge",
      label: "Shortlisting",
      validate: (v) => {
        if (!Array.isArray(v?.shortlist) || !v.shortlist.length) return "shortlist must be a non-empty array";
        if (v.shortlist.length > max) return `shortlist has ${v.shortlist.length} items, max is ${max}`;
        const unknown = v.shortlist.filter((s: any) => !longlist.includes(findCandidate(state, String(s.name))!));
        if (unknown.length) return `unknown names: ${unknown.map((s: any) => s.name).join(", ")}; use exact longlist names`;
        return null;
      },
    },
  );

  const keep = new Map(result.shortlist.map((s) => [findCandidate(state, s.name)!, s.reason]));
  // Products the person added are always researched, even beyond the limit.
  for (const c of longlist) if (c.addedByUser && !keep.has(c)) keep.set(c, "added by you");
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
  log(`Shortlist: ${longlist.filter((c) => c.status === "shortlist").map((c) => c.name).join("; ")}`, "ok");
  state.phase = "research";
}
