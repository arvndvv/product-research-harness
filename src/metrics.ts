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
import { domainMetrics } from "./knowledge.ts";
import { loadMetricLibrary, mergeMetricLibrary, setMetricComponent } from "./library.ts";
import { chatJSON } from "./llm.ts";
import type { MetricDef, RunState } from "./shared.ts";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Specifications are not measurements of quality. Power draw (TDP), core count
 * or clock speed don't say how fast a laptop is, and treating "lower TDP" as
 * "better performance" once ranked the slowest processor first. Measurements
 * must be measured outcomes: benchmarks, lab tests, timed results, weight.
 */
const SPEC_PROXY = /\b(tdp|thermal design power|core count|cores|threads|clock speed|base clock|boost clock|ghz|mhz|cache size|megapixels?|mp count)\b/i;
export function specProxy(def: Pick<MetricDef, "key" | "label" | "unit">): boolean {
  return SPEC_PROXY.test(`${def.key.replace(/_/g, " ")} ${def.label} ${def.unit}`);
}

/** Remove spec-sheet proxies from a run's measurement plan (older runs and libraries may have them). */
export function dropSpecProxies(state: RunState) {
  const dropped: string[] = [];
  for (const p of state.metricPlan ?? []) {
    p.keys = p.keys.filter((k) => {
      const d = state.metricDefs?.[k];
      if (d && specProxy(d)) {
        dropped.push(d.label);
        return false;
      }
      return true;
    });
  }
  if (dropped.length) log(`Not used as measurements (specifications, not measured results): ${[...new Set(dropped)].join(", ")}`, "warn");
}

/**
 * Is a recorded value plausible on this measurement's scale? Catches unit mix-ups
 * (1.24 recorded for a weight measured in grams) before they distort scores.
 */
export function implausible(def: MetricDef, value: number): string | null {
  const lo = Math.min(def.poor, def.good);
  const hi = Math.max(def.poor, def.good);
  if (lo > 0 && (value < lo / 10 || value > hi * 10)) {
    return `${value} is far outside the scale for ${def.label} (weak ${def.poor}, excellent ${def.good} ${def.unit}). Check the unit and convert it to ${def.unit} (e.g. kg to grams), or check you have the right number.`;
  }
  return null;
}

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
  /** Set when the value comes from another product with the same part (e.g. "AMD Ryzen 5 7530U"). */
  via?: string;
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
  const def = state.metricDefs?.[key];
  let obs = (state.metrics ?? []).filter((m) => m.key === key && norm(m.candidate) === norm(candidate));
  let via: string | undefined;
  // A part shared with other products (same processor): use what was measured for that part.
  if (!obs.length && def?.component) {
    const part = state.candidates.find((c) => norm(c.name) === norm(candidate))?.components?.[def.component];
    if (part) {
      obs = (state.metrics ?? []).filter((m) => m.key === key && m.component && norm(m.component) === norm(part));
      via = part;
    }
  }
  if (!obs.length) return { confirmed: false, sources: 0 };
  const status = statusOf(state, def, obs);
  return via ? { ...status, via } : status;
}

function statusOf(state: RunState, def: MetricDef | undefined, obs: NonNullable<RunState["metrics"]>): MetricStatus {
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

/**
 * Measurements every product in a comparison has. Products are only ranked on
 * the SAME numbers: if one laptop has a benchmark and another only has its
 * weight, comparing those would be meaningless, so a measurement missing for
 * any product is left out for all of them (they're compared side by side instead).
 */
export function comparableKeys(state: RunState, products: string[], criterion: string): { keys: string[]; leftOut: string[] } {
  const keys: string[] = [];
  const leftOut: string[] = [];
  for (const key of plannedKeys(state, criterion)) {
    const def = state.metricDefs?.[key];
    if (!def || specProxy(def)) continue;
    if (products.every((p) => metricStatus(state, p, key).value !== undefined)) keys.push(key);
    else if (products.some((p) => metricStatus(state, p, key).value !== undefined)) leftOut.push(def.label);
  }
  return { keys, leftOut };
}

/** Code-computed score for one criterion from measurements, plus what it's based on. */
export function metricScoreFor(state: RunState, candidate: string, criterion: string, onlyKeys?: string[]) {
  const keys = (onlyKeys ?? plannedKeys(state, criterion)).filter((k) => {
    const d = state.metricDefs?.[k];
    return d && !specProxy(d);
  });
  const measured: { key: string; label: string; value: number; unit: string; score: number; confirmed: boolean; via?: string }[] = [];
  for (const key of keys) {
    const def = state.metricDefs?.[key];
    const st = metricStatus(state, candidate, key);
    if (def && st.value !== undefined)
      measured.push({ key, label: def.label, value: st.value, unit: def.unit, score: scaleMetric(def, st.value), confirmed: st.confirmed, ...(st.via ? { via: st.via } : {}) });
  }
  const score = measured.length ? round1(measured.reduce((s, m) => s + m.score, 0) / measured.length) : undefined;
  // Confidence counts only confirmed measurements.
  const confirmed = measured.filter((m) => m.confirmed).length;
  return { score, measured, planned: keys.length, coverage: keys.length ? confirmed / keys.length : 0, confirmedShare: measured.length ? confirmed / measured.length : 0 };
}

// --- Planning ------------------------------------------------------------------------------

type PlanJSON = {
  criteria: {
    criterion: string;
    metrics: { key: string; label: string; unit: string; higher_is_better: boolean; poor: number; good: number; source_hint: string; source_domain?: string; component?: string }[];
  }[];
};

/**
 * Decide which measurements each criterion uses. Reuses the category library
 * (same keys and scales as earlier runs) and only adds what's missing.
 */
export async function planMetrics(state: RunState) {
  const req = state.requirements!;
  // Measurements from the domain guide join the library (existing keys keep their scale),
  // so the planner reuses trusted benchmarks instead of inventing new ones.
  const fromGuide = domainMetrics(req.category).filter((d) => !specProxy(d));
  if (fromGuide.length) mergeMetricLibrary(req.category, fromGuide);
  // Spec-sheet proxies saved by earlier versions are never offered again.
  const library = Object.fromEntries(Object.entries(loadMetricLibrary(req.category)).filter(([, d]) => !specProxy(d)));
  const libText = Object.values(library).length
    ? Object.values(library)
        .map((d) => `- ${d.key}: ${d.label} (${d.unit}, ${d.higherIsBetter ? "higher" : "lower"} is better, poor=${d.poor}, good=${d.good}; source: ${d.sourceHint}${d.component ? `; part: ${d.component}` : ""})`)
        .join("\n")
    : "(none yet: this is the first research in this category)";

  const plan = await chatJSON<PlanJSON>(
    [
      {
        role: "system",
        content: `You define OBJECTIVE, COMPARABLE measurements for scoring products. Reply in JSON.

Person and requirements:
${requirementsBlock(req, { rules: false })}

Existing measurements for this category (reuse these exact keys when a criterion needs the same thing; never redefine them. They come from the domain guide and earlier runs, so prefer them over new ones):
${libText}

For each scoring criterion, choose 0-3 metrics that:
- are published as NUMBERS by reputable testers or spec sheets for most products in this category (lab test scores, benchmarks, measured hours/minutes, weight in grams, brightness in nits, charging time...),
- are measured the same way for every product, ideally by ONE named source (e.g. "DXOMARK camera score", "GSMArena active use score in hours", "Geekbench 6 multi-core"); give that source's website as source_domain (e.g. "dxomark.com") when there is one,
- actually reflect what "good" means for this person on that criterion,
- are MEASURED OUTCOMES, not specifications used as proxies. A benchmark score, a lab test, measured battery hours or a measured temperature are outcomes. TDP / power rating, core count, clock speed (GHz), cache or megapixels are specs: they don't say how well a product performs (a lower-power chip is not a faster one), so never use them. Physical facts that ARE the outcome (weight in grams for portability, screen brightness in nits) are fine.
If a metric measures a part many products share (e.g. a processor benchmark like Geekbench 6 multi-core), set "component" to that part (e.g. "processor"): then every product with the same processor gets the same measured value, even when no review of that exact product has it.
Units: say exactly which unit values must be in (e.g. "grams", not "kg"), and give poor/good in that unit.
Use an empty list when a criterion is subjective (design, feel) or no comparable numbers exist; it will be judged side by side instead.
For NEW metrics give a fixed scale for THIS category today: "poor" = value of a weak product, "good" = value of an excellent product. (If lower is better, poor > good.)
Keys: lowercase snake_case, specific (e.g. "dxomark_camera", not "camera").

JSON: {"criteria":[{"criterion":"<exact criterion name>","metrics":[{"key":"...","label":"...","unit":"...","higher_is_better":true,"poor":0,"good":0,"source_hint":"...","source_domain":"...","component":"optional, e.g. processor"}]}]}
For an existing key, just repeat the key (add "component" if it measures a shared part); other fields are ignored.`,
      },
      { role: "user", content: `Criteria:\n${req.criteria.map((c) => `- ${c.name}: ${c.description}`).join("\n")}` },
    ],
    {
      profile: "judge",
      label: "Planning measurements",
      validate: (v) => {
        if (!Array.isArray(v?.criteria)) return 'missing "criteria" array';
        for (const c of req.criteria) {
          const entry = v.criteria.find((x: any) => x?.criterion === c.name);
          if (!entry) return `missing criterion "${c.name}" (use the exact name)`;
          if (!Array.isArray(entry.metrics)) return `"metrics" for "${c.name}" must be an array`;
          for (const m of entry.metrics) {
            if (!/^[a-z0-9_]{3,40}$/.test(String(m?.key))) return `metric key "${m?.key}" must be lowercase snake_case`;
            if (library[m.key]) continue;
            if (specProxy({ key: String(m.key), label: String(m.label ?? ""), unit: String(m.unit ?? "") }))
              return `"${m.key}" (${m.label}) is a specification, not a measured result: use a benchmark or lab test for "${c.name}", or no metric`;
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
          component: m.component ? String(m.component).trim().toLowerCase() || undefined : undefined,
        });
      } else if (library[m.key] && !library[m.key].component && m.component) {
        // An existing measurement turns out to measure a shared part: record that (its scale doesn't change).
        setMetricComponent(req.category, m.key, String(m.component).trim().toLowerCase());
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
