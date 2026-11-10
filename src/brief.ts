/**
 * Adjusting the brief after results are in.
 *
 * The evidence already collected doesn't change when your priorities do, so
 * most edits are cheap:
 *   - weights, budget            -> re-rank in code, instantly (no model calls)
 *   - must-haves, dealbreakers   -> each product is re-judged from its evidence
 * Either way only the report is rewritten. Nothing new is searched: for a
 * different kind of product or a much bigger budget, start a new research.
 */
import { applyHardFilters } from "./phases/score.ts";
import type { BriefEdit, RunState } from "./shared.ts";
import { findCandidate, newCandidate } from "./state.ts";

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const clean = (xs: string[] | undefined) => (xs ?? []).map((x) => String(x).trim()).filter(Boolean);

export function validateBriefEdit(state: RunState, edit: BriefEdit): string | null {
  const req = state.requirements;
  if (!req) return "this research has no brief yet (the interview isn't finished)";
  if (edit.weights) {
    const names = new Set(req.criteria.map((c) => c.name));
    for (const [name, w] of Object.entries(edit.weights)) {
      if (!names.has(name)) return `unknown criterion "${name}"`;
      if (!Number.isFinite(w) || w < 0 || w > 100) return `weight for "${name}" must be 0-100`;
    }
    const merged = req.criteria.map((c) => edit.weights![c.name] ?? c.weight);
    const sum = merged.reduce((s, w) => s + w, 0);
    if (Math.abs(sum - 100) > 1) return `weights must add up to 100 (they add up to ${sum})`;
    if (!merged.some((w) => w > 0)) return "at least one criterion needs a weight above 0";
  }
  if (edit.budget) {
    if (!Number.isFinite(edit.budget.max) || edit.budget.max < 0) return "budget must be 0 (no budget) or more";
    if (!Number.isFinite(edit.budget.flexPercent) || edit.budget.flexPercent < 0 || edit.budget.flexPercent > 100) return "stretch must be 0-100%";
  }
  return null;
}

/**
 * Apply an edit to the run. Returns what changed (for the activity log) and
 * whether products must be re-judged by the model.
 */
export function applyBriefEdit(state: RunState, edit: BriefEdit): { changes: string[]; needsRescore: boolean } {
  const req = state.requirements!;
  const changes: string[] = [];
  let needsRescore = false;

  if (edit.weights) {
    for (const c of req.criteria) {
      const w = edit.weights[c.name];
      if (w !== undefined && Math.round(w) !== c.weight) {
        changes.push(`${c.name} weight ${c.weight} → ${Math.round(w)}`);
        c.weight = Math.round(w);
      }
    }
  }

  if (edit.budget) {
    const flex = req.budget.flexPercent ?? 0;
    if (edit.budget.max !== req.budget.max || edit.budget.flexPercent !== flex) {
      changes.push(`budget ${req.budget.max} (+${flex}%) → ${edit.budget.max} (+${edit.budget.flexPercent}%)`);
      req.budget.max = edit.budget.max;
      req.budget.flexPercent = edit.budget.flexPercent;
    }
  }

  const lists = [
    ["mustHaves", "must-haves", true],
    ["dealbreakers", "dealbreakers", true],
    ["niceToHaves", "nice-to-haves", false],
  ] as const;
  for (const [key, label, rejudge] of lists) {
    const next = edit[key];
    if (!next) continue;
    const value = clean(next);
    if (!sameList(value, req[key])) {
      changes.push(`${label}: ${value.join(", ") || "(none)"}`);
      req[key] = value;
      if (rejudge) needsRescore = true;
    }
  }

  if (changes.length) {
    state.briefEdits = [...(state.briefEdits ?? []), { t: new Date().toISOString(), changes }];
    applyHardFilters(state);
  }
  return { changes, needsRescore };
}

/**
 * Decide what runs next after an edit. Only a finished run is re-ranked and
 * re-reported here; a paused run simply continues with the new brief on Resume.
 */
export function planAfterEdit(state: RunState, needsRescore: boolean): "report" | "score" | "none" {
  if (state.phase !== "done") {
    if (needsRescore) for (const c of state.candidates) if (c.status === "shortlist" && c.scores) c.dirty = true;
    return "none";
  }
  if (needsRescore) {
    for (const c of state.candidates) if (c.status === "shortlist") c.dirty = true;
    state.rescoreOnly = true;
    state.phase = "score";
    return "score";
  }
  state.phase = "report";
  return "report";
}

/**
 * Add a product the person thinks is worth considering. It's researched and
 * scored exactly like the others (same evidence bar, budget check and
 * side-by-side comparison); on a finished run, only research, scoring and the
 * report run again.
 */
export function addUserCandidate(state: RunState, rawName: string, note: string): { name: string; start: boolean } | { error: string } {
  const name = rawName.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 120) return { error: "give the product's full name, e.g. 'Samsung Galaxy S24 FE'" };
  if (!state.requirements) return { error: "finish the interview first" };
  const why = `Added by you${note.trim() ? `: ${note.trim()}` : ""}`;
  const existing = findCandidate(state, name);
  if (existing && existing.status === "shortlist") return { error: `${existing.name} is already being compared` };
  if (existing) {
    existing.status = "shortlist";
    existing.addedByUser = true;
    existing.whyConsidered = why;
    existing.cutReason = undefined;
    existing.researched = false;
    existing.dirty = true;
  } else {
    const c = newCandidate({ name, price: "", whyConsidered: why, source: "", status: "shortlist", round: state.round });
    c.addedByUser = true;
    state.candidates.push(c);
  }
  if (state.phase === "done") {
    state.phase = "research";
    state.rescoreOnly = true; // research it, score everything, rewrite the report; no new critique rounds
    return { name: existing?.name ?? name, start: true };
  }
  // A paused run picks it up when resumed.
  return { name: existing?.name ?? name, start: false };
}
