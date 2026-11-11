/**
 * Category knowledge library: what the harness keeps between runs, per
 * product category (knowledge/<category>/):
 *
 *   metrics.json         measurement definitions with fixed scales. The first
 *                        run in a category defines them; later runs reuse the
 *                        same keys and anchors, so scores are comparable and
 *                        repeatable across runs.
 *   products/<name>.json findings, measurements and prices per product, dated.
 *                        Reused for a few days so running the same request
 *                        twice gives the same data (and costs much less).
 *   seen.json            products considered in earlier runs, shown to
 *                        discovery so the candidate list is stable too.
 *
 * Everything is plain JSON you can open, edit or delete.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import type { Evidence, MetricDef, MetricObservation, PriceObservation } from "./shared.ts";

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "x";

/** "Smartphones" and "smartphone" share one library. */
export function categoryKey(category: string): string {
  return slug(
    category
      .toLowerCase()
      .split(/\s+/)
      .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
      .join(" "),
  );
}

const dir = (category: string) => join(config.paths.knowledge, categoryKey(category));

function readJson<T>(file: string, fallback: T): T {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

// --- Decision factors --------------------------------------------------------------

/** What buyers of this category weigh (display, battery, ports...): the interview must account for each. */
export function loadFactors(category: string): string[] {
  return readJson(join(dir(category), "factors.json"), [] as string[]);
}

export function saveFactors(category: string, factors: string[]) {
  writeJson(join(dir(category), "factors.json"), factors);
}

// --- Measurement definitions ----------------------------------------------------

export function loadMetricLibrary(category: string): Record<string, MetricDef> {
  return readJson(join(dir(category), "metrics.json"), {});
}

/**
 * Add new definitions. Existing keys are never overwritten: keeping the same
 * scale is what makes scores comparable between runs.
 */
/** Mark an existing measurement as one of a shared part (e.g. "processor"). The scale is untouched. */
export function setMetricComponent(category: string, key: string, component: string) {
  const lib = loadMetricLibrary(category);
  if (!lib[key] || lib[key].component) return;
  lib[key] = { ...lib[key], component };
  writeJson(join(dir(category), "metrics.json"), lib);
}

export function mergeMetricLibrary(category: string, defs: MetricDef[]): Record<string, MetricDef> {
  const lib = loadMetricLibrary(category);
  for (const d of defs) if (!lib[d.key]) lib[d.key] = d;
  writeJson(join(dir(category), "metrics.json"), lib);
  return lib;
}

// --- Product research cache ---------------------------------------------------------

export type ProductCache = {
  name: string;
  updatedAt: string;
  evidence: Omit<Evidence, "id" | "round">[];
  metrics: Omit<MetricObservation, "id" | "round">[];
  prices: (Omit<PriceObservation, "id" | "round"> & { seenAt: string })[];
};

const productFile = (category: string, name: string) => join(dir(category), "products", `${slug(name)}.json`);

export function loadProduct(category: string, name: string): ProductCache | null {
  return readJson<ProductCache | null>(productFile(category, name), null);
}

export function saveProduct(category: string, entry: ProductCache) {
  writeJson(productFile(category, entry.name), entry);
}

export const ageDays = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86_400_000;

// --- Products seen in earlier runs ------------------------------------------------------

export type SeenProduct = { name: string; lastSeen: string; price?: string; outcome: string };

export function loadSeen(category: string): SeenProduct[] {
  return readJson(join(dir(category), "seen.json"), []);
}

export function recordSeen(category: string, items: SeenProduct[]) {
  const seen = loadSeen(category);
  for (const item of items) {
    const i = seen.findIndex((s) => slug(s.name) === slug(item.name));
    if (i >= 0) seen[i] = item;
    else seen.push(item);
  }
  seen.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  writeJson(join(dir(category), "seen.json"), seen.slice(0, 60));
}
