/** Human-readable views of the state, used in prompts and in notes.md. */
import type { Evidence, Requirements, RunState } from "./state.ts";
import { rank, scoreboard } from "./scoring.ts";

/**
 * Requirements as text. With rules (default) it includes instructions meant
 * for the model; without, it's the plain summary shown to the person.
 */
export function requirementsBlock(req: Requirements, opts: { rules?: boolean } = {}): string {
  const rules = opts.rules ?? true;
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `  - ${x}`).join("\n") : "  (none)");
  return [
    `Category: ${req.category}`,
    `Summary: ${req.summary}`,
    `Use case: ${req.useCase}`,
    `Budget: ${req.budget.max > 0 ? `up to ${req.budget.max} ${req.budget.currency}${req.budget.flexPercent ? `, can stretch ${req.budget.flexPercent}%` : ", strict"}` : "no fixed budget"}${req.budget.notes ? ` (${req.budget.notes})` : ""}`,
    `Region (buying in): ${req.region}`,
    ...(!rules ? [] : [`Pricing rule: compare prices to the budget ONLY in ${req.budget.currency || "the person's currency"}, using prices from sellers in ${req.region} ` +
      `(brand's local site, local retailers/marketplaces). Prices quoted in reviews from other countries are not local prices: ` +
      `never convert them by exchange rate and treat the result as the real price, since duties, launch pricing and discounts differ. ` +
      `If no local price is found, say "local price unknown" and give the foreign price with its currency.`]),
    `Must-haves (hard filter):\n${list(req.mustHaves)}`,
    `Dealbreakers (hard filter):\n${list(req.dealbreakers)}`,
    `Nice-to-haves:\n${list(req.niceToHaves)}`,
    ...(req.assumptions?.length ? [`Assumed (correct me if wrong):\n${list(req.assumptions)}`] : []),
    `Scoring criteria (weight out of 100, and what "good" means for this person):`,
    ...req.criteria.map((c) => `  - ${c.name} [${c.weight}]: ${c.description}`),
  ].join("\n");
}

export function evidenceBlock(evidence: Evidence[]): string {
  if (!evidence.length) return "(no evidence yet)";
  return evidence
    .map((e) => `${e.id} [${e.criterion}] (${e.sentiment}, ${e.sourceType}${e.cachedFrom ? `, from research on ${e.cachedFrom}` : ""}) ${e.finding}\n    source: ${e.sourceUrl}`)
    .join("\n");
}

export function renderNotes(state: RunState): string {
  const out: string[] = [`# Research notes: ${state.initialRequest}`, "", `Phase: ${state.phase} | Round: ${state.round}`, ""];
  const req = state.requirements;
  if (req) out.push("## Requirements", "", "```", requirementsBlock(req, { rules: false }), "```", "");

  if (state.candidates.length) {
    out.push("## Candidates", "");
    for (const c of state.candidates) {
      const extra = c.status === "cut" ? ` - cut: ${c.cutReason}` : c.disqualified ? ` - disqualified: ${c.disqualified}` : c.incomplete ? ` - incomplete: ${c.incomplete}` : "";
      out.push(`- **${c.name}** (${c.status}${c.price ? `, ${c.price}` : ""})${extra}`);
    }
    out.push("");
  }

  if (req) {
    const ranked = rank(state.candidates);
    if (ranked.length) out.push("## Scoreboard", "", scoreboard(req, ranked), "");
  }

  if (state.critiqueNotes.length) {
    out.push("## Critic notes", "", ...state.critiqueNotes.map((n) => `- ${n}`), "");
  }

  if (state.metricPlan?.length) {
    out.push("## Measurements", "");
    for (const p of state.metricPlan) {
      out.push(`- **${p.criterion}**: ${p.keys.length ? p.keys.map((k) => state.metricDefs?.[k]?.label ?? k).join(", ") : "judged side by side"}`);
    }
    for (const m of state.metrics ?? []) {
      const d = state.metricDefs?.[m.key];
      out.push(`  - ${m.candidate}: ${d?.label ?? m.key} = ${m.value} ${d?.unit ?? ""} [source](${m.sourceUrl})${m.cachedFrom ? ` (from ${m.cachedFrom})` : ""}`);
    }
    out.push("");
  }

  if (state.prices?.length) {
    out.push("## Prices seen", "");
    for (const p of state.prices) {
      out.push(`- ${p.id} **${p.candidate}**: ${p.currency} ${p.amount} (${p.kind}, ${p.sourceType}) at ${p.seller} [link](${p.url})`);
    }
    out.push("");
  }

  const names = [...new Set(state.evidence.map((e) => e.candidate))];
  if (names.length) {
    out.push("## Evidence", "");
    for (const name of names) {
      out.push(`### ${name}`, "");
      for (const e of state.evidence.filter((x) => x.candidate === name)) {
        out.push(`- ${e.id} **${e.criterion}** (${e.sentiment}, ${e.sourceType}): ${e.finding} [source](${e.sourceUrl})`);
      }
      out.push("");
    }
  }
  return out.join("\n");
}
