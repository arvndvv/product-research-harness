/**
 * Scoring math lives in code, not in the model.
 *
 * The model judges each criterion (0-10, with evidence). Code does the
 * weighting, the ranking and the disqualification. So the final pick is
 * reproducible, and asking "are you sure?" can't make it flip on a whim.
 */
import type { Candidate, Requirements, Score } from "./state.ts";

/** Weighted total on a 0-100 scale. */
export function computeTotal(req: Requirements, scores: Score[]): number {
  let total = 0;
  for (const c of req.criteria) {
    const s = scores.find((x) => x.criterion === c.name);
    total += ((s?.score ?? 0) / 10) * c.weight;
  }
  return Math.round(total * 10) / 10;
}

/** Can this product be recommended? Disqualified and incompletely researched ones can't. */
export const eligible = (c: Candidate) => !c.disqualified && !c.incomplete;

const tier = (c: Candidate) => (eligible(c) ? 0 : c.incomplete && !c.disqualified ? 1 : 2);

/** Shortlisted + scored candidates: eligible first (highest total first), then incomplete, then disqualified. */
export function rank(candidates: Candidate[]): Candidate[] {
  return candidates
    .filter((c) => c.status === "shortlist" && c.total !== undefined)
    .sort((a, b) => tier(a) - tier(b) || (b.total ?? 0) - (a.total ?? 0));
}

/**
 * Eligible products within TIE_MARGIN points of the leader (at most 3).
 * Differences that small are inside the margin of error of the scoring, so
 * they're presented as effectively tied rather than as a confident ranking.
 */
export function tieGroup(ranked: Candidate[], margin: number): Candidate[] {
  const ok = ranked.filter(eligible);
  if (!ok.length) return [];
  const top = ok[0].total ?? 0;
  return ok.filter((c) => top - (c.total ?? 0) < margin).slice(0, 3);
}

export function statusText(c: Candidate): string {
  if (c.disqualified) return `out: ${c.disqualified}`;
  if (c.incomplete) return `not enough evidence: ${c.incomplete}`;
  if (c.bestPrice && !c.bestPrice.verified) return "ok (price unverified)";
  return "ok";
}

const money = (p: Candidate["bestPrice"]) =>
  p ? `${p.currency.toUpperCase() === "INR" ? "₹" : p.currency + " "}${Math.round(p.amount).toLocaleString("en-IN")}${p.verified ? "" : "?"}` : "-";

export function scoreboard(req: Requirements, ranked: Candidate[]): string {
  const head = ["#", "Product", "Total", "Price", ...req.criteria.map((c) => `${c.name} (${c.weight})`), "Status"];
  const rows = ranked.map((c, i) => [
    String(i + 1),
    c.name,
    String(c.total ?? "-"),
    money(c.bestPrice),
    ...req.criteria.map((cr) => {
      const s = c.scores?.find((x) => x.criterion === cr.name);
      if (!s) return "-";
      const conf = s.confidence === "high" ? "" : s.confidence === "medium" ? "~" : "?";
      return `${s.score}${conf}`;
    }),
    statusText(c),
  ]);
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [
    line(head),
    line(head.map(() => "---")),
    ...rows.map(line),
    "",
    "Scores are 0-10 per criterion. `~` = medium confidence, `?` = low confidence. Total is weighted, 0-100. Price = lowest current local price found; `?` = only seen in articles, not on a seller's page.",
  ].join("\n");
}
