/**
 * Two kinds of knowledge the harness carries between runs, both plain files:
 *
 *  - domains/<topic>.md  : domain packs. Expert guidance for a category
 *    (what matters, which sources to trust). Written by you, not the model.
 *  - memory/profile.json : durable facts about the user ("country: India",
 *    "shoe size: UK 7"). Intake adds to it; you can edit it in the UI.
 *    Intake uses it to pre-fill suggested answers.
 *
 * The code never changes; the knowledge files grow. That's the safe version
 * of a "self-improving" harness.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import type { MetricDef, ProfileFact } from "./shared.ts";

// --- Domain packs -------------------------------------------------------------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The guide for a category. A guide matches by its file name (singular or
 * plural) or an "Aliases:" line, as whole words. When several match, the one
 * naming the product itself wins: "ssd for laptop" -> ssd, "laptop ram" -> ram
 * (the part before "for/with/under", and the last product word in it).
 */
export function findDomainPack(category: string): { name: string; text: string } | null {
  const dir = config.paths.domains;
  if (!existsSync(dir)) return null;
  const head = category.toLowerCase().split(/\b(?:for|with|under|below|within|around)\b/)[0];
  let best: { name: string; text: string; at: number; len: number } | null = null;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const text = readFileSync(join(dir, file), "utf8");
    const base = file.slice(0, -3).toLowerCase().replace(/[-_]+/g, " ");
    const aliases = (text.match(/^aliases:\s*(.+)$/im)?.[1] ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);
    for (const term of [base, base.replace(/(es|s)$/, ""), ...aliases]) {
      if (term.length < 2) continue;
      const m = new RegExp(`\\b${escapeRe(term)}(?:s|es)?\\b`).exec(head);
      if (m && (!best || m.index > best.at || (m.index === best.at && term.length > best.len))) best = { name: file, text, at: m.index, len: term.length };
    }
  }
  return best ? { name: best.name, text: best.text } : null;
}
const loadDomainPack = findDomainPack;

/** One "## Heading" section of a guide (up to the next "## "), or "". */
function section(text: string, heading: RegExp): string {
  const parts = text.split(/^## /m);
  const hit = parts.find((p) => heading.test(p.split("\n")[0]));
  return hit ? hit.split("\n").slice(1).join("\n") : "";
}

export function domainBlock(category: string): string {
  const pack = loadDomainPack(category);
  if (!pack) return "";
  // The measurement table is for code (it seeds the measurement library), not for prompts.
  const text = pack.text.replace(/^## Measurements[\s\S]*?(?=^## |(?![\s\S]))/m, "").trim();
  return `\nDomain guidance (from ${pack.name}, written by a human expert; follow it):\n${text}\n`;
}

/**
 * The guide's "## Decision factors" list: what the interview must account for
 * (asked, known, or a visible assumption). Bullet text before ":" or " - ".
 */
export function domainFactors(category: string): string[] {
  const pack = loadDomainPack(category);
  if (!pack) return [];
  return section(pack.text, /^decision factors/i)
    .split("\n")
    .map((l) => l.match(/^\s*[-*]\s+(.+)$/)?.[1] ?? "")
    .map((l) => l.replace(/\*\*/g, "").split(/:| [-–—] /)[0].trim())
    .filter((l) => l.length >= 2)
    .slice(0, 14);
}

/**
 * The guide's "## Measurements" table: trusted measurements with fixed scales
 * for the category. They seed the measurement library, so every run in the
 * category uses the same benchmarks and scales from the start.
 *
 * | key | label | unit | better | poor | good | source | part |
 */
export function domainMetrics(category: string): MetricDef[] {
  const pack = loadDomainPack(category);
  if (!pack) return [];
  const defs: MetricDef[] = [];
  for (const line of section(pack.text, /^measurements/i).split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 8) continue;
    const [, key, label, unit, better, poor, good, source, part] = cells;
    if (!/^[a-z0-9_]{3,40}$/.test(key)) continue; // header and separator rows
    const p = Number(poor);
    const g = Number(good);
    if (!Number.isFinite(p) || !Number.isFinite(g) || p === g) continue;
    defs.push({
      key,
      label,
      unit,
      higherIsBetter: !/^lower/i.test(better),
      poor: p,
      good: g,
      sourceHint: source.replace(/`/g, ""),
      sourceDomain: source.match(/[a-z0-9-]+\.[a-z.]{2,}/i)?.[0]?.toLowerCase(),
      component: part && part !== "-" ? part.toLowerCase() : undefined,
    });
  }
  return defs;
}

// --- User profile ---------------------------------------------------------------

const profileFile = () => join(config.paths.memory, "profile.json");
const legacyProfileFile = () => join(config.paths.memory, "profile.md");

export function loadProfile(): ProfileFact[] {
  if (existsSync(profileFile())) return JSON.parse(readFileSync(profileFile(), "utf8")) as ProfileFact[];
  // One-time migration from the older markdown profile.
  if (existsSync(legacyProfileFile())) {
    const now = new Date().toISOString();
    const facts = readFileSync(legacyProfileFile(), "utf8")
      .split(/\r?\n/)
      .filter((l) => l.startsWith("- "))
      .map((l): ProfileFact => ({ id: randomUUID(), text: l.slice(2).trim(), source: "intake", updatedAt: now }));
    saveProfile(facts);
    return facts;
  }
  return [];
}

export function saveProfile(facts: ProfileFact[]) {
  mkdirSync(config.paths.memory, { recursive: true });
  writeFileSync(profileFile(), JSON.stringify(facts, null, 2));
}

/** The "topic" of a fact written as "topic: value", used to replace outdated facts. */
const topicOf = (text: string) => {
  const m = text.match(/^([^:]{2,40}):/);
  return m ? m[1].trim().toLowerCase() : null;
};

/**
 * Merge new facts into the profile. Exact duplicates are skipped; a fact with
 * the same "topic:" as an existing one replaces it (e.g. a new shoe size).
 */
export function addProfileFacts(items: { text: string; scope?: string }[], source: ProfileFact["source"] = "intake"): ProfileFact[] {
  const facts = loadProfile();
  const now = new Date().toISOString();
  const scopeKey = (s?: string) => (s ?? "").trim().toLowerCase();
  for (const item of items) {
    const text = item.text.trim();
    const scope = item.scope?.trim() || undefined;
    if (!text) continue;
    const sameScope = facts.filter((f) => scopeKey(f.scope) === scopeKey(scope));
    if (sameScope.some((f) => f.text.toLowerCase() === text.toLowerCase())) continue;
    const topic = topicOf(text);
    const existing = topic ? sameScope.find((f) => topicOf(f.text) === topic) : undefined;
    if (existing) {
      existing.text = text;
      existing.updatedAt = now;
      existing.source = source;
    } else {
      facts.push({ id: randomUUID(), text, scope, source, updatedAt: now });
    }
  }
  saveProfile(facts);
  return facts;
}

/** Profile for prompts: general facts first, then product-specific ones grouped by scope. */
export function profileText(): string {
  const facts = loadProfile();
  const general = facts.filter((f) => !f.scope);
  const scopes = [...new Set(facts.filter((f) => f.scope).map((f) => f.scope!))];
  const lines = general.map((f) => `- ${f.text}`);
  for (const s of scopes) {
    lines.push(`For ${s}:`, ...facts.filter((f) => f.scope === s).map((f) => `  - ${f.text}`));
  }
  return lines.join("\n");
}
