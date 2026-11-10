/**
 * Setup helpers behind the Settings and Domain guides pages:
 * connection tests, model lists, and domain guide files.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { chat, type ChatRequest } from "./llm.ts";
import { loadSettings, llmTarget } from "./settings.ts";
import { search } from "./tools/web.ts";
import type { DomainGuide } from "./shared.ts";

// --- Connection tests -----------------------------------------------------------------

export async function testConnection(target: "main" | "judge" | "search"): Promise<{ ok: boolean; ms: number; detail: string }> {
  const started = Date.now();
  try {
    if (target === "search") {
      const results = await search("best budget smartphone review", 3);
      return { ok: results.length > 0, ms: Date.now() - started, detail: results.length ? `${results.length} results, e.g. "${results[0].title}"` : "no results returned" };
    }
    const t = llmTarget(target);
    // A tiny real call that also checks tool calling works, since the research agents depend on it.
    const req: ChatRequest = {
      profile: target,
      temperature: 0,
      messages: [{ role: "user", content: "Call the ping tool with the word ok." }],
      tools: [{ type: "function", function: { name: "ping", description: "Connectivity check", parameters: { type: "object", properties: { word: { type: "string" } }, required: ["word"] } } }],
    };
    const reply = await chat(req);
    const usedTool = !!reply.tool_calls?.length;
    return {
      ok: true,
      ms: Date.now() - started,
      detail: `${t.model} at ${t.providerName} replied${usedTool ? " and supports tool calling" : ", but did NOT call the tool: research may not work well with this model"}`,
    };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, detail: (e as Error).message.slice(0, 300) };
  }
}

/** Models offered by a provider (OpenAI-compatible GET /models), for the model picker. */
export async function listModels(providerId: string): Promise<string[]> {
  const p = loadSettings().providers.find((x) => x.id === providerId);
  if (!p) throw new Error("unknown provider");
  const res = await fetch(`${p.baseUrl.replace(/\/$/, "")}/models`, {
    headers: p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {},
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${p.name}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  const ids: string[] = (data.data ?? data.models ?? []).map((m: any) => String(m.id ?? m.name ?? "")).filter(Boolean);
  return [...new Set(ids)].sort();
}

// --- Domain guides ----------------------------------------------------------------------

const GUIDE_NAME = /^[a-z0-9][a-z0-9-]{1,40}$/;

export function guideName(raw: string): string | null {
  const name = raw.toLowerCase().trim().replace(/\.md$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return GUIDE_NAME.test(name) ? name : null;
}

const guideFile = (name: string) => join(config.paths.domains, `${name}.md`);

export function listGuides(): DomainGuide[] {
  if (!existsSync(config.paths.domains)) return [];
  return readdirSync(config.paths.domains)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const st = statSync(join(config.paths.domains, f));
      return { name: f.slice(0, -3), size: st.size, updatedAt: st.mtime.toISOString() };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readGuide(name: string): string | null {
  return existsSync(guideFile(name)) ? readFileSync(guideFile(name), "utf8") : null;
}

export function writeGuide(name: string, content: string) {
  mkdirSync(config.paths.domains, { recursive: true });
  writeFileSync(guideFile(name), content.endsWith("\n") ? content : content + "\n");
}

export function deleteGuide(name: string): boolean {
  if (!existsSync(guideFile(name))) return false;
  unlinkSync(guideFile(name));
  return true;
}

/** A starting draft for a new guide, written by the judge model. Not saved until the person saves it. */
export async function draftGuide(name: string): Promise<string> {
  const example = readGuide("shoes") ?? "";
  const reply = await chat({
    profile: "judge",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: `You write a short domain guide in Markdown for a product-research assistant. It's injected into the assistant's prompts when someone researches this category.

Sections: "# Domain guide: <category>", "## What actually matters" (the factors that really separate good from bad products, with the measurable specs and typical ranges), "## Sources" (types of reliable sources: lab tests, specialist reviewers, owner communities; name well-known ones only if you're confident they exist), "## Pitfalls" (version confusion, misleading specs, regional differences).
Be concrete and concise (under 400 words). No prices. Say so when something is a general rule of thumb.${example ? `\n\nExample of the style (a guide for shoes):\n${example}` : ""}`,
      },
      { role: "user", content: `Category: ${name.replace(/-/g, " ")}` },
    ],
  });
  return (reply.content ?? "").trim().replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i, "$1");
}
