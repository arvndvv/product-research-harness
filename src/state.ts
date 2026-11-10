/**
 * Run state, persisted to disk after every meaningful change.
 *
 * Why files instead of keeping everything in the conversation:
 *  - the model's context stays small (it reads summaries, not history)
 *  - a crash or Ctrl+C loses nothing: `npm start -- --resume runs/<id>`
 *  - you can open the files and see exactly what the agent knows
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { renderNotes } from "./format.ts";

export type {
  Candidate,
  Criterion,
  Evidence,
  Phase,
  Requirements,
  RunState,
  Score,
  SourceType,
} from "./shared.ts";
import type { Candidate, Evidence, Requirements, RunState } from "./shared.ts";
import { emit } from "./context.ts";

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "run";
}

export function createRun(initialRequest: string): RunState {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  // Unique even when the same request is started twice in a minute.
  let id = `${stamp}-${slugify(initialRequest)}`;
  for (let n = 2; existsSync(join(config.paths.runs, id)); n++) id = `${stamp}-${slugify(initialRequest)}-${n}`;
  const dir = join(config.paths.runs, id);
  mkdirSync(dir, { recursive: true });
  const state: RunState = {
    id,
    dir,
    createdAt: d.toISOString(),
    initialRequest,
    phase: "intake",
    round: 0,
    candidates: [],
    evidence: [],
    critiqueNotes: [],
  };
  saveState(state);
  return state;
}

export function saveState(state: RunState) {
  writeFileSync(join(state.dir, "state.json"), JSON.stringify(state, null, 2));
  writeFileSync(join(state.dir, "notes.md"), renderNotes(state));
  emit({ type: "state" }); // lets a UI refresh its view
}

export function loadState(dir: string): RunState {
  const file = join(dir, "state.json");
  if (!existsSync(file)) throw new Error(`No state.json in ${dir}`);
  const state = JSON.parse(readFileSync(file, "utf8")) as RunState;
  state.dir = dir;
  return state;
}

export function logEvent(state: RunState, event: Record<string, unknown>) {
  appendFileSync(join(state.dir, "log.jsonl"), JSON.stringify({ t: new Date().toISOString(), phase: state.phase, ...event }) + "\n");
}

// --- small helpers used across phases --------------------------------------

export function newCandidate(fields: Pick<Candidate, "name" | "price" | "whyConsidered" | "source" | "status"> & { round: number }): Candidate {
  return {
    name: fields.name,
    price: fields.price,
    whyConsidered: fields.whyConsidered,
    source: fields.source,
    status: fields.status,
    addedInRound: fields.round,
    researched: false,
    followups: [],
    notes: [],
    dirty: true,
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function findCandidate(state: RunState, name: string): Candidate | undefined {
  const n = norm(name);
  return state.candidates.find((c) => norm(c.name) === n);
}

export function evidenceFor(state: RunState, candidateName: string): Evidence[] {
  const n = norm(candidateName);
  return state.evidence.filter((e) => norm(e.candidate) === n);
}

export function matchCriterion(req: Requirements, name: string): string | undefined {
  if (norm(name) === "general") return "general";
  return req.criteria.find((c) => norm(c.name) === norm(name))?.name;
}
