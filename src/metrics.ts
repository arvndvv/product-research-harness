/**
 * Measurements: the objective half of scoring.
 *
 * Each criterion gets 0-3 measurable metrics (lab camera score, benchmark,
 * measured battery hours...). Each metric has a FIXED scale: a "poor" and a
 * "good" reference value for the category. Code maps a measured value onto
 * 0-10 with that scale, so:
 *   - the same measurements always give the same score
 *   - a product's score doesn't depend on which other products are in the list
 *   - review tone can't move the number
 */
import { config } from "./config.ts";
import { log } from "./context.ts";
import { requirementsBlock } from "./format.ts";
import { loadMetricLibrary, mergeMetricLibrary } from "./library.ts";
import { chatJSON } from "./llm.ts";
import type { MetricDef, RunState } from "./shared.ts";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const round1 = (x: number) => Math.round(x * 10) / 10;

/** Map a measured value onto 0-10 using the metric's fixed scale. */
export function scaleMetric(def: MetricDef, value: number): number {
  const span = def.good - def.poor;
  if (!span) return 5;
  const t = (value - def.poor) / span; // works for lower-is-better too: there good < poor
  return round1(Math.max(0, Math.min(10, t * 10)));
}

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};
const domain = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export type MetricStatus = {
  value?: number;
  /** From the authoritative site, or two independent sites agreeing. */
  confirmed: boolean;
  /** Independent sources disagree: research must find the authoritative value. */
  conflict?: string;
  sources: number;
};

/**
 * How trustworthy is a product's measurement?
 *  - a value from the metric's authoritative site counts on its own
 *  - otherwise two different sites must agree (within METRIC_AGREEMENT)
 *  - different sites disagreeing is a conflict, not something to average away
 */
export function metricStatus(state: RunState, candidate: string, key: string): MetricStatus {
  const obs = (state.metrics ?? []).filter((m) => m.key === key && norm(m.candidate) === norm(candidate));
  if (!obs.length) return { confirmed: false, sources: 0 };
  const def = state.metricDefs?.[key];
  const sites = new Set(obs.map((o) => domain(o.sourceUrl)));
  const authority = def?.sourceDomain?.replace(/^www\./, "").toLowerCase();
  const fromAuthority = authority ? obs.filter((o) => domain(o.sourceUrl).toLowerCase().endsWith(authority)) : [];
  if (fromAuthority.length) return { value: median(fromAuthority.map((o) => o.value)), confirmed: true, sources: sites.size };

  const mid = median(obs.map((o) => o.value));
  const tol = Math.max(Math.abs(mid) * config.scoring.metricAgreement, 1e-9);
  const agreeing = obs.filter((o) => Math.abs(o.value - mid) <= tol);
  const agreeingSites = new Set(agreeing.map((o) => domain(o.sourceUrl)));
  if (agreeingSites.size >= 2) return { value: median(agreeing.map((o) => o.value)), confirmed: true, sources: sites.size };
  if (sites.size >= 2) {
    const detail = obs.map((o) => `${o.value} (${domain(o.sourceUrl)})`).join(" vs ");
    return { value: mid, confirmed: false, conflict: `conflicting values: ${detail}`, sources: sites.size };
  }
  return { value: mid, confirmed: false, sources: sites.size };
}

/** Best available value for a product's measurement (see metricStatus). */
export function measuredValue(state: RunState, candidate: string, key: string): number | undefined {
  return metricStatus(state, candidate, key).value;
}

/** Keys planned for a criterion. */
function plannedKeys(state: RunState, criterion: string): string[] {
  return state.metricPlan?.find((p) => p.criterion === criterion)?.keys ?? [];
}

/** Code-computed score for one criterion from measurements, plus what it's based on. */
export function metricScoreFor(state: RunState, candidate: string, criterion: string) {
  const keys = plannedKeys(state, criterion);
  const measured: { key: string; label: string; value: number; unit: string; score: number; confirmed: boolean }[] = [];
  for (const key of keys) {
    const def = state.metricDefs?.[key];
    const st = metricStatus(state, candidate, key);
    if (def && st.value !== undefined) measured.push({ key, label: def.label, value: st.value, unit: def.unit, score: scaleMetric(def, st.value), confirmed: st.confirmed });
  }
  const score = measured.length ? round1(measured.reduce((s, m) => s + m.score, 0) / measured.length) : undefined;
  // Confidence counts only confirmed measurements.
  const confirmed = measured.filter((m) => m.confirmed).length;
  return { score, measured, planned: keys.length, coverage: keys.length ? confirmed / keys.length : 0 };
}

// --- Planning ------------------------------------------------------------------------------

type PlanJSON = {
  criteria: {
    criterion: string;
    metrics: { key: string; label: string; unit: string; higher_is_better: boolean; poor: number; good: number; source_hint: string; source_domain?: string }[];
  }[];
};

/**
 * Decide which measurements each criterion uses. Reuses the category library
 * (same keys and scales as earlier runs) and only adds what's missing.
 */
export async function planMetrics(state: RunState) {
  const req = state.requirements!;
  const library = loadMetricLibrary(req.category);
  const libText = Object.values(library).length
    ? Object.values(library)
        .map((d) => `- ${d.key}: ${d.label} (${d.unit}, ${d.higherIsBetter ? "higher" : "lower"} is better, poor=${d.poor}, good=${d.good}; source: ${d.sourceHint})`)
        .join("\n")
    : "(none yet: this is the first research in this category)";

  const plan = await chatJSON<PlanJSON>(
    [
      {
        role: "system",
        content: `You define OBJECTIVE, COMPARABLE measurements for scoring products. Reply in JSON.

Person and requirements:
${requirementsBlock(req, { rules: false })}

Existing measurements for this category (reuse these exact keys when a criterion needs the same thing; never redefine them):
${libText}

For each scoring criterion, choose 0-3 metrics that:
- are published as NUMBERS by reputable testers or spec sheets for most products in this category (lab test scores, benchmarks, measured hours/minutes, weight in grams, brightness in nits, charging time...),
- are measured the same way for every product, ideally by ONE named source (e.g. "DXOMARK camera score", "GSMArena active use score in hours", "Geekbench 6 multi-core"); give that source's website as source_domain (e.g. "dxomark.com") when there is one,
- actually reflect what "good" means for this person on that criterion.
Use an empty list when a criterion is subjective (design, feel) or no comparable numbers exist; it will be judged side by side instead.
For NEW metrics give a fixed scale for THIS category today: "poor" = value of a weak product, "good" = value of an excellent product. (If lower is better, poor > good.)
Keys: lowercase snake_case, specific (e.g. "dxomark_camera", not "camera").

JSON: {"criteria":[{"criterion":"<exact criterion name>","metrics":[{"key":"...","label":"...","unit":"...","higher_is_better":true,"poor":0,"good":0,"source_hint":"...","source_domain":"..."}]}]}
For an existing key, just repeat the key; other fields are ignored.`,
      },
      { role: "user", content: `Criteria:\n${req.criteria.map((c) => `- ${c.name}: ${c.description}`).join("\n")}` },
    ],
    {
      profile: "judge",
      validate: (v) => {
        if (!Array.isArray(v?.criteria)) return 'missing "criteria" array';
        for (const c of req.criteria) {
          const entry = v.criteria.find((x: any) => x?.criterion === c.name);
          if (!entry) return `missing criterion "${c.name}" (use the exact name)`;
          if (!Array.isArray(entry.metrics)) return `"metrics" for "${c.name}" must be an array`;
          for (const m of entry.metrics) {
            if (!/^[a-z0-9_]{3,40}$/.test(String(m?.key))) return `metric key "${m?.key}" must be lowercase snake_case`;
            if (library[m.key]) continue;
            if (!Number.isFinite(Number(m.poor)) || !Number.isFinite(Number(m.good)) || Number(m.poor) === Number(m.good))
              return `metric "${m.key}" needs numeric "poor" and "good" values that differ`;
          }
        }
        return null;
      },
    },
  );

  const fresh: MetricDef[] = [];
  const planOut: { criterion: string; keys: string[] }[] = [];
  for (const c of req.criteria) {
    const entry = plan.criteria.find((x) => x.criterion === c.name)!;
    const keys: string[] = [];
    for (const m of entry.metrics.slice(0, 3)) {
      if (!library[m.key] && !fresh.some((f) => f.key === m.key)) {
        const higher = m.higher_is_better !== false;
        fresh.push({
          key: m.key,
          label: String(m.label || m.key),
          unit: String(m.unit || ""),
          higherIsBetter: higher,
          poor: Number(m.poor),
          good: Number(m.good),
          sourceHint: String(m.source_hint || ""),
          sourceDomain: m.source_domain ? String(m.source_domain).replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase() || undefined : undefined,
        });
      }
      if (!keys.includes(m.key)) keys.push(m.key);
    }
    planOut.push({ criterion: c.name, keys });
  }

  const merged = mergeMetricLibrary(req.category, fresh);
  state.metricPlan = planOut;
  state.metricDefs = Object.fromEntries(planOut.flatMap((p) => p.keys).map((k) => [k, merged[k]]).filter(([, d]) => d));
  const described = planOut.map((p) => `${p.criterion}: ${p.keys.length ? p.keys.map((k) => merged[k]?.label ?? k).join(", ") : "judged side by side"}`);
  log(`Measurement plan: ${described.join(" | ")}${fresh.length ? ` (${fresh.length} new, saved for future runs)` : ""}`, "ok");
}
