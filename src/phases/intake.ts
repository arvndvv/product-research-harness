/**
 * Phase 1: Intake. Understand the person before researching anything.
 *
 * This is a code-controlled interview, not a free chat. Every turn the model
 * returns JSON with:
 *   - known:         what it already knows (said, implied by an answer, or from the profile)
 *   - next_question: ONE question, with why the answer would change the result
 *   - requirements:  the final brief, once nothing important is unknown
 *
 * Code enforces what prompts alone can't guarantee:
 *   - a question budget (INTAKE_MAX_QUESTIONS)
 *   - no questions about topics already known, no near-duplicate questions
 *   - valid requirements (weights, criteria count) and the person's confirmation
 *   - only stated facts reach the profile (no "likely ..." guesses)
 *
 * Each turn is a fresh, stateless call with the full Q&A so far, which keeps
 * the context small and the behaviour predictable.
 */
import { config } from "../config.ts";
import { ask, log } from "../context.ts";
import { requirementsBlock } from "../format.ts";
import { addProfileFacts, profileText } from "../knowledge.ts";
import { chatJSON } from "../llm.ts";
import { saveState, type Requirements, type RunState } from "../state.ts";

type Known = { topic: string; value: string; source: "said" | "implied" | "profile" };
type NextQuestion = { question: string; why_it_matters: string; resolves: string; suggested_answer?: string; options?: string[] };
type IntakeTurn = {
  known: Known[];
  next_question: NextQuestion | null;
  requirements: Record<string, unknown> | null;
  profile_updates?: { fact: string; scope?: string }[];
};
type QA = { question: string; answer: string; resolves?: string; correction?: boolean };

/** Profile facts code may use without asking: where they live and pay. Everything else is a suggestion to confirm. */
const LOCATION_TOPIC = /\b(country|region|currency|location|city|state)\b/i;

/** Topics a question covered ("OS, brand" -> ["os", "brand"]). */
const topicsOf = (resolves = "") => resolves.split(/,|\band\b|\//).map(norm).filter(Boolean);

/**
 * Profile facts that matter for this product but haven't been confirmed in
 * this interview. Preferences change ("Android last time" may not hold now),
 * so they must be asked, with the saved answer as the suggestion.
 */
export function unconfirmedProfileFacts(known: Known[], qa: QA[]): Known[] {
  const asked = new Set(qa.flatMap((x) => topicsOf(x.resolves)));
  return known.filter((k) => k.source === "profile" && !LOCATION_TOPIC.test(k.topic) && !asked.has(norm(k.topic)));
}

const arr = (x: unknown) => (Array.isArray(x) ? x.map(String).map((s) => s.trim()).filter(Boolean) : []);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 3));

/** Rough similarity of two questions (shared meaningful words). */
export function questionOverlap(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size);
}

function toRequirements(a: any): Requirements {
  return {
    category: String(a.category ?? "").trim(),
    summary: String(a.summary ?? "").trim(),
    useCase: String(a.use_case ?? "").trim(),
    budget: {
      max: Number(a.budget_max) || 0,
      currency: String(a.currency ?? ""),
      notes: String(a.budget_notes ?? ""),
      flexPercent: Math.max(0, Math.min(100, Number(a.budget_flex_percent) || 0)),
    },
    region: String(a.region ?? "").trim(),
    mustHaves: arr(a.must_haves),
    niceToHaves: arr(a.nice_to_haves),
    dealbreakers: arr(a.dealbreakers),
    criteria: (Array.isArray(a.criteria) ? a.criteria : []).map((c: any) => ({
      name: String(c.name ?? "").trim(),
      weight: Math.round(Number(c.weight) || 0),
      description: String(c.description ?? "").trim(),
    })),
    assumptions: arr(a.assumptions),
    userProfile: [],
  };
}

export function validateRequirements(r: Requirements): string | null {
  if (!r.category) return "category is empty";
  if (!r.region) return "region is empty; ask where they are buying";
  if (r.criteria.length < 3 || r.criteria.length > 8) return `need 3-8 criteria, got ${r.criteria.length}`;
  const names = r.criteria.map((c) => c.name.toLowerCase());
  if (new Set(names).size !== names.length) return "criterion names must be unique";
  if (names.includes("general")) return '"general" is reserved; rename that criterion';
  const sum = r.criteria.reduce((s, c) => s + c.weight, 0);
  if (Math.abs(sum - 100) > 1) return `criteria weights must sum to 100, they sum to ${sum}`;
  if (r.criteria.some((c) => c.weight <= 0)) return "every criterion needs a positive weight";
  return null;
}

/** Profile facts must be things the person said, not the model's guesses. */
const HEDGE = /\b(likely|probably|maybe|might|perhaps|seems?|assum\w*|guess\w*|possibly|unclear|unknown)\b/i;

/**
 * Check one interview turn. Returns a problem for the model to fix, or null.
 * Exported for tests: this is where the "don't ask redundant questions" rule lives.
 */
export function checkTurn(turn: IntakeTurn, qa: QA[], remaining: number): string | null {
  if (!Array.isArray(turn?.known)) return 'missing "known" array';
  const q = turn.next_question;
  if (q && remaining > 0) {
    if (!q.question?.trim()) return "next_question.question is empty";
    if (!q.why_it_matters?.trim()) return "next_question.why_it_matters is empty: say how the answer changes which products fit";
    const topics = topicsOf(q.resolves);
    const settled = turn.known.filter((k) => k.source !== "profile" && topics.includes(norm(k.topic)));
    const already = topics.length > 0 && settled.length === topics.length ? settled[0] : undefined;
    if (already) return `you already know "${already.topic}" (${already.value}); don't ask about it. Ask about something unknown, or finish with requirements.`;
    const dup = qa.find((x) => !x.correction && questionOverlap(x.question, q.question) >= 0.7);
    if (dup) return `that question is nearly the same as one already asked ("${dup.question}", answered "${dup.answer}"). Ask something new, or finish.`;
    return null;
  }
  if (!turn.requirements) {
    return remaining <= 0 ? "no questions left: set next_question to null and return requirements now" : "return either next_question or requirements";
  }
  const pending = unconfirmedProfileFacts(turn.known, qa);
  if (pending.length && remaining > 0) {
    return `profile facts are suggestions, not answers. Before finishing, confirm: ${pending.map((k) => `"${k.topic}: ${k.value}"`).join(", ")}. Ask about them (you may combine them in one question; set "resolves" to the topic names) with the saved value as suggested_answer.`;
  }
  return validateRequirements(toRequirements(turn.requirements));
}

function systemPrompt(maxQuestions: number) {
  return `You run the intake interview for a purchase-research assistant. Goal: understand the person well enough that research can find the ONE product that fits them best, with as FEW questions as possible.

Reply every turn with a JSON object:
{
  "known": [{"topic": "short topic", "value": "...", "source": "said" | "implied" | "profile"}],
  "next_question": {"question": "...", "why_it_matters": "how the answer changes which products fit", "resolves": "the topic it fills", "suggested_answer": "optional", "options": ["optional", "..."]} or null,
  "requirements": null or { ...see below... },
  "profile_updates": [ ...only together with requirements, see below... ]
}

Deciding what to ask:
1. First fill "known" from the opening request, the answers so far and the profile. Include what is clearly IMPLIED. Example: if they said photography is a main use, then "camera priority: high" is known (implied). Don't ask how often they take photos.
   From the profile, list only facts that matter for THIS product (a shoe size doesn't matter for a phone), with source "profile".
2. Profile facts are SUGGESTIONS, not answers: preferences change. Country and currency can be used directly. Every other relevant profile fact must be confirmed by a question, with the saved value as suggested_answer (e.g. "Still prefer Android?" suggested "Android"). Related ones can be combined in one question; put all their topics in "resolves", comma-separated, using the same topic names as in "known".
3. Only ask if the answer would change which products are considered or how they're ranked. Worth asking: budget if missing, country if unknown, hard constraints (size, OS/ecosystem, compatibility, space), what they disliked about a previous product, how they'd trade off two priorities that pull against each other. Not worth asking: frequency or intensity when the use is already clear, confirming what they already said, generic checklists, anything whose answer wouldn't change the shortlist.
4. Ask the most decision-relevant question first. Combine closely related points into one question when natural.
5. Give 2-5 short options when answers are typical. Fill suggested_answer when the profile or earlier answers make one likely.
6. You may ask at most ${maxQuestions} questions in total. When nothing decision-relevant is unknown, or no questions are left, set next_question to null and return requirements. Reasonable assumptions are fine: list them in "assumptions"; the person confirms the summary and can correct them.

requirements:
{"category": "product type in a few words", "summary": "2-3 sentences: the person and the need", "use_case": "concrete situations",
 "budget_max": number (0 if no budget), "currency": "e.g. INR", "budget_flex_percent": number (0 if strict; 10 if they'd stretch about 10%), "budget_notes": "",
 "region": "country they're buying in",
 "must_haves": [], "nice_to_haves": [], "dealbreakers": [],
 "criteria": [{"name": "short", "weight": integer, "description": "what good means FOR THIS PERSON"}] (4-8 criteria, weights sum to 100, reflecting their priorities),
 "assumptions": ["things you assumed without asking"]}
Must-haves and dealbreakers: only hard requirements the person stated. Price is handled by the budget; don't add it as a must-have or criterion.

profile_updates: durable facts worth remembering for FUTURE purchases, only things the person said or confirmed, never guesses. Each {"fact": "topic: value", "scope": ""} where scope is "" for facts that apply to everything (country, currency, general taste) or the product area for product-specific preferences, e.g. {"fact": "OS: Android", "scope": "smartphones"}. Skip facts already in the profile unless they changed.`;
}

function turnMessage(state: RunState, qa: QA[], remaining: number) {
  const profile = profileText();
  const history = qa.length
    ? qa.map((x, i) => (x.correction ? `Correction to the summary: "${x.answer}"` : `Q${i + 1}${x.resolves ? ` (about: ${x.resolves})` : ""}: ${x.question}\nA: ${x.answer}`)).join("\n\n")
    : "(no questions asked yet)";
  return `Opening request: "${state.initialRequest}"

Known profile of this person (from earlier sessions):
${profile || "(empty)"}

Interview so far:
${history}

Questions left: ${remaining}`;
}

export async function intakePhase(state: RunState) {
  const max = config.limits.intakeQuestions;
  const qa: QA[] = [];
  let corrections = 0;

  for (let turnNo = 0; turnNo < max + 12; turnNo++) {
    const asked = qa.filter((x) => !x.correction).length;
    // Each correction at the confirm step earns one follow-up question.
    const remaining = Math.max(0, max + corrections - asked);

    const turn = await chatJSON<IntakeTurn>(
      [
        { role: "system", content: systemPrompt(max) },
        { role: "user", content: turnMessage(state, qa, remaining) },
      ],
      { validate: (t) => checkTurn(t, qa, remaining), temperature: 0.2, label: "Interview" },
    );

    const q = turn.next_question;
    if (q && remaining > 0) {
      log(`[interview] asking about ${q.resolves || "a gap"}: ${q.why_it_matters}`, "dim");
      const answer = await ask(q.question.trim(), {
        suggestion: q.suggested_answer?.trim() || undefined,
        options: Array.isArray(q.options) && q.options.length ? q.options.map(String).slice(0, 6) : undefined,
        progress: `Question ${asked + 1} of up to ${max + corrections}`,
      });
      qa.push({ question: q.question.trim(), answer: answer || "(no answer)", resolves: q.resolves });
      continue;
    }

    // Summary to confirm. If the question budget ran out before some profile
    // preferences were confirmed, show them as assumptions to correct.
    const req = toRequirements(turn.requirements);
    const unconfirmed = unconfirmedProfileFacts(turn.known, qa);
    if (unconfirmed.length) {
      req.assumptions = [...(req.assumptions ?? []), ...unconfirmed.map((k) => `from your profile: ${k.topic}: ${k.value}`)];
    }
    const answer = await ask("Does this capture what you need? Accept, or type what to change.", {
      details: requirementsBlock(req, { rules: false }),
      options: ["Yes, looks right"],
    });
    if (!/^(y|yes|ok|correct)\b/i.test(answer.trim())) {
      corrections++;
      qa.push({ question: "Confirm summary", answer, correction: true });
      continue;
    }

    // Save stated, durable facts to the profile. Guesses are dropped in code.
    const updates = (turn.profile_updates ?? [])
      .map((u) => ({ text: String(u?.fact ?? "").trim(), scope: String(u?.scope ?? "").trim() || undefined }))
      .filter((u) => u.text && !HEDGE.test(u.text));
    if (updates.length) {
      addProfileFacts(updates, "intake");
      log(`Saved to your profile: ${updates.map((u) => (u.scope ? `${u.text} (${u.scope})` : u.text)).join("; ")}`, "ok");
    }
    req.userProfile = updates.map((u) => u.text);
    state.requirements = req;
    state.profileUpdates = req.userProfile;
    saveState(state);
    state.phase = "discover";
    return;
  }
  throw new Error("Interview did not converge. Try again with a more specific request.");
}
