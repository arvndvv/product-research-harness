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
import type { ProfileFact } from "./shared.ts";

// --- Domain packs -------------------------------------------------------------

function loadDomainPack(category: string): { name: string; text: string } | null {
  const dir = config.paths.domains;
  if (!existsSync(dir)) return null;
  const cat = category.toLowerCase();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const base = file.slice(0, -3).toLowerCase();
    const singular = base.replace(/s$/, "");
    if (cat.includes(base) || cat.includes(singular)) {
      return { name: file, text: readFileSync(join(dir, file), "utf8") };
    }
  }
  return null;
}

export function domainBlock(category: string): string {
  const pack = loadDomainPack(category);
  return pack ? `\nDomain guidance (from ${pack.name}, written by a human expert; follow it):\n${pack.text}\n` : "";
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
