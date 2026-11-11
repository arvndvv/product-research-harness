/**
 * Phase 6: Critique. This is the loop that makes research iterate.
 *
 * A skeptical reviewer looks at the scoreboard and the evidence gaps and
 * decides: is this decision solid, or do we need another round? It can send
 * targeted questions back to research, or propose a product we missed.
 * Code caps the number of rounds so it always terminates.
 */
import { log } from "../context.ts";
import { config } from "../config.ts";
import { requirementsBlock } from "../format.ts";
import { chatJSON } from "../llm.ts";
import { budgetLimit, formatMoney, pricesFor } from "../pricing.ts";
import { rank, statusText } from "../scoring.ts";
import { evidenceFor, findCandidate, newCandidate, type RunState } from "../state.ts";

type CritiqueJSON = {
  verdict: "done" | "iterate";
  notes: string;
  research_tasks: { candidate: string; question: string }[];
  new_candidates: { name: string; reason: string; expected_price?: number }[];
};

export async function critiquePhase(state: RunState) {
  const req = state.requirements!;
  const { maxRounds } = config.limits;

  if (state.round >= maxRounds) {
    log(`Max research rounds (${maxRounds}) reached; moving to the report.`);
    state.phase = "report";
    return;
  }

  const ranked = rank(state.candidates);
  const board = ranked
    .map((c, i) => {
      const ev = evidenceFor(state, c.name);
      const perCrit = req.criteria
        .map((cr) => {
          const s = c.scores?.find((x) => x.criterion === cr.name);
          const n = ev.filter((e) => e.criterion === cr.name).length;
          return `${cr.name}: ${s?.score ?? "-"}/10 (${s?.confidence ?? "-"} conf, ${n} findings)`;
        })
        .join("; ");
      const community = ev.filter((e) => e.sourceType === "community").length;
      const p = c.bestPrice;
      const price = p ? `${formatMoney(p.amount, p.currency)} at ${p.seller}${p.verified ? "" : " (UNVERIFIED: only seen in articles)"}` : `no price found (${pricesFor(state, c.name).length} price records)`;
      return `${i + 1}. ${c.name}: total ${c.total}; status: ${statusText(c)}; price: ${price}; community findings: ${community}\n   ${perCrit}\n   notes: ${c.notes.join(" | ")}`;
    })
    .join("\n");
  const cut = state.candidates.filter((c) => c.status === "cut").map((c) => `${c.name} (${c.cutReason})`);

  const result = await chatJSON<CritiqueJSON>([
    {
      role: "system",
      content: `You are a skeptical senior reviewer checking a purchase recommendation before it goes to the person. Your job is to catch weak conclusions, not to polish. Reply in JSON.

Person and requirements:
${requirementsBlock(req)}

Budget limit: ${budgetLimit(req) === Infinity ? "none" : formatMoney(budgetLimit(req), req.budget.currency)}. Products over it are ruled out by code once a seller price confirms it.

Iterate ONLY for real reasons, such as:
- the leader's price is unverified or missing, so it may actually be over budget: ask research to check current seller prices
- the top two eligible products are within ~6 points, so the decision is shaky
- the leader has low confidence on a criterion weighted 15 or more
- a top-3 product has fewer than 2 findings on a high-weight criterion
- the leader has no owner/community evidence (durability and real-world problems unknown)
- a must-have is "unknown" for the leader
- you know a SPECIFIC product (exact model) that is likely a better fit for this person than everything here, isn't listed or cut already, AND is likely sold within the budget today (e.g. a previous-generation premium model now discounted). Name it, explain why, and give its expected current price. Never propose "better" products that are likely above the budget: an over-budget product is not a better fit.

Limits: at most 4 research_tasks (each a specific question for a specific candidate) and at most 2 new_candidates. If the decision is already solid, return verdict "done" with empty lists.

JSON format:
{"verdict":"done|iterate","notes":"short assessment","research_tasks":[{"candidate":"<exact name>","question":"..."}],"new_candidates":[{"name":"...","reason":"...","expected_price":number}]}`,
    },
    {
      role: "user",
      content: `Round ${state.round + 1} of max ${maxRounds}.\n\nScoreboard:\n${board || "(nothing scored)"}\n\nAlready cut: ${cut.join("; ") || "(none)"}`,
    },
  ], { profile: "judge", label: "Reviewing the decision" });

  state.critiqueNotes.push(`Round ${state.round}: ${result.verdict} - ${result.notes}`);
  log(`Critic: ${result.verdict}. ${result.notes}`, result.verdict === "done" ? "ok" : "info");

  let work = 0;
  if (result.verdict === "iterate") {
    for (const t of (result.research_tasks ?? []).slice(0, 4)) {
      const c = findCandidate(state, t.candidate);
      if (c?.status === "shortlist") {
        c.followups.push(t.question);
        work++;
        log(`Follow-up for ${c.name}: ${t.question}`);
      }
    }
    const stretch = budgetLimit(req) * (1 + config.limits.priceToVerifyPercent / 100);
    for (const n of (result.new_candidates ?? []).slice(0, 2)) {
      if (!n.name || findCandidate(state, n.name)) continue;
      if (Number(n.expected_price) > stretch) {
        log(`Skipped reviewer suggestion ${n.name}: expected price ${formatMoney(Number(n.expected_price), req.budget.currency)} is well over budget`, "warn");
        continue;
      }
      state.candidates.push(
        newCandidate({ name: n.name, price: "", whyConsidered: `Suggested by reviewer: ${n.reason}`, source: "", status: "shortlist", round: state.round + 1 }),
      );
      work++;
      log(`New candidate: ${n.name}`);
    }
  }

  if (work === 0) {
    state.phase = "report";
  } else {
    state.round++;
    state.phase = "research";
  }
}
