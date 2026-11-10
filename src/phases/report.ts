/**
 * Phase 7: Report. The winner is chosen by code (the ranking). The model only
 * explains it, and must cite evidence ids. Code appends the scoreboard and
 * source list so nothing in them can be hallucinated.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { evidenceBlock, requirementsBlock } from "../format.ts";
import { chat } from "../llm.ts";
import { formatMoney } from "../pricing.ts";
import { recordSeen } from "../library.ts";
import { config } from "../config.ts";
import { eligible, rank, scoreboard, tieGroup } from "../scoring.ts";
import { evidenceFor, type RunState } from "../state.ts";

/** Models sometimes wrap the whole answer in ```markdown ... ```; unwrap it. */
export function stripOuterFence(text: string): string {
  const m = text.trim().match(/^```(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i);
  return m ? m[1] : text;
}

export async function reportPhase(state: RunState) {
  const req = state.requirements!;
  const ranked = rank(state.candidates);
  const qualified = ranked.filter(eligible);
  const winner = qualified[0];
  const runnerUp = qualified[1];

  let body: string;
  if (!winner) {
    body = `## No product met all your hard requirements\n\nEvery researched product was over budget, failed a must-have, hit a dealbreaker, or couldn't be researched well enough (see the scoreboard). Consider relaxing a constraint or widening the budget, then run again.`;
  } else {
    const tied = tieGroup(ranked, config.scoring.tieMargin);
    const isTie = tied.length >= 2;
    const top = isTie ? tied : [winner, runnerUp].filter(Boolean);
    const decision = isTie
      ? `${tied.map((c) => `"${c.name}" (${c.total})`).join(", ")} are EFFECTIVELY TIED: their totals are within ${config.scoring.tieMargin} points, inside the scoring's margin of error. Present them as co-recommendations; don't pick one by fiat.`
      : `the winner is "${winner.name}"${runnerUp ? ` and the runner-up is "${runnerUp.name}"` : ""}. Do not change or second-guess the ranking.`;
    const mainSections = isTie
      ? [
          "## Top picks (effectively tied): <names>",
          "One short paragraph per product: who it suits best, tied to this person's use case and priorities. Cite evidence like [E12].",
          "## What decides it for you",
          'The one or two concrete factors, from this person\'s stated priorities, that separate them, phrased as "If X matters more to you, choose A; if Y, choose B".',
          "## What you give up with each",
          "Honest weaknesses and risks of each, with citations. Include owner-reported problems.",
        ].join("\n")
      : [
          "## Recommendation: <winner>",
          "Why it fits THIS person specifically, tied to their use case and top-weighted criteria. Cite evidence like [E12].",
          "## What you give up",
          "Honest weaknesses and risks of the winner, with citations. Include owner-reported problems.",
          "## Runner-up: <name> (if there is one)",
          "When to choose it instead, in one or two concrete conditions.",
        ].join("\n");
    const evidence = top.map((c) => `### ${c!.name}\n${evidenceBlock(evidenceFor(state, c!.name))}`).join("\n\n");
    const priceLine = (c: typeof winner) =>
      c.bestPrice
        ? `${c.name}: ${formatMoney(c.bestPrice.amount, c.bestPrice.currency)} at ${c.bestPrice.seller} (${c.bestPrice.url})${c.bestPrice.verified ? "" : " - UNVERIFIED, only seen in articles; tell the person to check the current price"}`
        : `${c.name}: no local price found; tell the person to check the current price`;
    const prices = top.map((c) => priceLine(c!)).join("\n");

    const reply = await chat({
      profile: "judge",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: `You write the final recommendation for one person, in Markdown. The decision is FINAL and was made by a scoring process: ${decision}

Person and requirements:
${requirementsBlock(req)}

Write these sections:
${mainSections}
## What would change this recommendation
Specific facts that would flip the decision (e.g. "if your feet are narrow...", "if the price drops below...").
## Buying notes
Use exactly these prices (computed from seller pages; don't use other prices or convert currencies):
${prices}
Then availability in ${req.region}, sizing or version pitfalls, from the evidence.

Rules: use only the evidence given; cite ids; be direct; no filler.`,
        },
        {
          role: "user",
          content: `Scores:\n${scoreboard(req, ranked)}\n\nCritic notes:\n${state.critiqueNotes.join("\n") || "(none)"}\n\nEvidence:\n${evidence}`,
        },
      ],
    });
    body = stripOuterFence(reply.content ?? "(model returned no text)");
  }

  const used = [...new Set(state.evidence.map((e) => e.sourceUrl))];
  const report = [
    `# ${req.category}: recommendation`,
    "",
    `_For: ${req.summary}_`,
    "",
    body.trim(),
    "",
    "## Scoreboard",
    "",
    scoreboard(req, ranked),
    "",
    "## Evidence index",
    "",
    ...state.evidence.map((e) => `- ${e.id} (${e.candidate}, ${e.criterion}): [${e.sourceUrl}](${e.sourceUrl})`),
    "",
    `_${state.evidence.length} findings from ${used.length} pages, ${state.round + 1} research round(s)._`,
  ].join("\n");

  // Remember what was considered, so the next run in this category starts from it.
  const tiedFinal = tieGroup(ranked, config.scoring.tieMargin);
  const now = new Date().toISOString();
  recordSeen(
    req.category,
    state.candidates.map((c) => ({
      name: c.name,
      lastSeen: now,
      price: c.bestPrice ? formatMoney(c.bestPrice.amount, c.bestPrice.currency) : c.price || undefined,
      outcome:
        tiedFinal.length >= 2 && tiedFinal.includes(c) ? "co-recommended (tie)" : c === winner ? "recommended" : c === runnerUp ? "runner-up" : c.status === "cut" ? `cut: ${c.cutReason ?? ""}`.slice(0, 80) : c.disqualified ? `ruled out: ${c.disqualified}`.slice(0, 80) : c.incomplete ? "not enough evidence" : "shortlisted",
    })),
  );

  state.reportPath = join(state.dir, "report.md");
  writeFileSync(state.reportPath, report);
  state.phase = "done";
}
