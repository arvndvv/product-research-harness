/**
 * Local web server: the harness as an app.
 *
 *   npm run app   ->  http://localhost:4321
 *
 * The server is a second front end for the same pipeline the CLI runs.
 * The only difference is the RunIO it supplies (see context.ts):
 *   - emit()  -> stored in events.jsonl and pushed to browsers via SSE
 *   - ask()   -> becomes a "pending question"; the promise resolves when the
 *                browser POSTs an answer
 *
 * Plain node:http, no framework, so the whole thing stays readable.
 * Binds to 127.0.0.1 only: there is no auth, so it must not be exposed.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { addUserCandidate, applyBriefEdit, planAfterEdit, validateBriefEdit } from "./brief.ts";
import { applyUpdate, llmTarget, missingSettings, PROVIDER_PRESETS, SEARCH_OPTIONS, searchSettings, settingsView, validateUpdate, loadSettings } from "./settings.ts";
import { deleteGuide, draftGuide, guideName, listGuides, listModels, readGuide, testConnection, writeGuide } from "./admin.ts";
import { config } from "./config.ts";
import { StopError, withIO, type RunIO } from "./context.ts";
import { addProfileFacts, loadProfile, saveProfile } from "./knowledge.ts";
import { runPipeline } from "./runner.ts";
import { eligible, rank } from "./scoring.ts";
import type { Health, PendingQuestion, ProfileFact, RunDetail, RunEvent, RunEventInput, RunStatus, RunSummary } from "./shared.ts";
import { createRun, loadState, logEvent, saveState, type RunState } from "./state.ts";

const PORT = Number(process.env.PORT || 4321);
const HOST = "127.0.0.1";
const WEB_DIST = resolve("web/dist");

// --- In-memory state of runs that are currently executing --------------------

type ActiveRun = {
  status: RunStatus;
  error?: string;
  pending?: PendingQuestion & { resolve: (answer: string) => void; reject: (e: Error) => void };
  /** Aborting it stops the run (see context.ts). */
  controller?: AbortController;
  clients: Set<ServerResponse>;
};
const active = new Map<string, ActiveRun>();

const runDir = (id: string) => join(config.paths.runs, id);
const validId = (id: string) => /^[A-Za-z0-9._-]+$/.test(id) && existsSync(join(runDir(id), "state.json"));

function getActive(id: string): ActiveRun {
  let a = active.get(id);
  if (!a) {
    a = { status: "idle", clients: new Set() };
    active.set(id, a);
  }
  return a;
}

/** Record an event: persist (except noisy ones) and push to connected browsers. */
function publish(id: string, input: RunEventInput) {
  const event = { t: new Date().toISOString(), ...input } as RunEvent;
  if (event.type !== "state") appendFileSync(join(runDir(id), "events.jsonl"), JSON.stringify(event) + "\n");
  const a = active.get(id);
  if (!a) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of a.clients) res.write(data);
}

function setStatus(id: string, status: RunStatus, error?: string) {
  const a = getActive(id);
  a.status = status;
  a.error = error;
  publish(id, { type: "status", status, error });
}

function readEvents(id: string, limit = 800): RunEvent[] {
  const file = join(runDir(id), "events.jsonl");
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  return lines.slice(-limit).map((l) => JSON.parse(l) as RunEvent);
}

function statusOf(state: RunState): RunStatus {
  const a = active.get(state.id);
  if (a && a.status !== "idle") return a.status;
  return state.phase === "done" ? "done" : "idle";
}

/** Start (or resume) the pipeline for a run in the background. */
function startRun(state: RunState) {
  const a = getActive(state.id);
  if (a.status === "running" || a.status === "waiting") return;

  const controller = new AbortController();
  a.controller = controller;
  const io: RunIO = {
    signal: controller.signal,
    emit: (e) => publish(state.id, e),
    trace: (e) => logEvent(state, e),
    ask: (question, opts = {}) =>
      new Promise<string>((resolveAnswer, reject) => {
        const q: PendingQuestion = { id: randomUUID(), question, ...opts };
        a.pending = { ...q, resolve: resolveAnswer, reject };
        publish(state.id, { type: "question", question: q });
        setStatus(state.id, "waiting");
      }),
  };

  setStatus(state.id, "running");
  withIO(io, () => runPipeline(state))
    .then(() => setStatus(state.id, "done"))
    .catch((e: Error) => {
      saveState(state);
      a.pending = undefined;
      if (e instanceof StopError || controller.signal.aborted) {
        publish(state.id, { type: "log", level: "warn", text: `Stopped by you during "${state.phase}". Progress is saved; Resume continues from here.` });
        setStatus(state.id, "idle");
        return;
      }
      publish(state.id, { type: "log", level: "warn", text: `Stopped: ${e.message}` });
      setStatus(state.id, "error", e.message);
    })
    .finally(() => {
      if (a.controller === controller) a.controller = undefined;
    });
}

// --- HTTP helpers ---------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<any> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

function summarize(state: RunState): RunSummary {
  const winner = state.phase === "done" ? rank(state.candidates).find(eligible)?.name : undefined;
  return {
    id: state.id,
    request: state.initialRequest,
    category: state.requirements?.category,
    phase: state.phase,
    round: state.round,
    status: statusOf(state),
    createdAt: state.createdAt,
    winner,
  };
}

function listRuns(): RunSummary[] {
  if (!existsSync(config.paths.runs)) return [];
  return readdirSync(config.paths.runs)
    .filter((id) => validId(id))
    .map((id) => summarize(loadState(runDir(id))))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function runDetail(id: string): RunDetail {
  const state = loadState(runDir(id));
  const a = active.get(id);
  const reportFile = join(runDir(id), "report.md");
  return {
    state,
    status: statusOf(state),
    error: a?.error,
    pending: a?.pending ? (({ resolve: _resolve, reject: _reject, ...q }) => q)(a.pending) : undefined,
    report: existsSync(reportFile) ? readFileSync(reportFile, "utf8") : undefined,
    events: readEvents(id),
    tieMargin: config.scoring.tieMargin,
  };
}

function health(): Health {
  return {
    mainModel: llmTarget("main").model,
    judgeModel: llmTarget("judge").model,
    search: searchSettings().provider,
    missing: missingSettings(),
    tieMargin: config.scoring.tieMargin,
  };
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

function serveStatic(pathname: string, res: ServerResponse) {
  if (!existsSync(WEB_DIST)) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("UI not built yet. Run `npm run app` (builds the UI and starts the server), or `npm run web:dev` for development.");
    return;
  }
  let file = resolve(WEB_DIST, "." + decodeURIComponent(pathname));
  if (!file.startsWith(WEB_DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(WEB_DIST, "index.html"); // SPA fallback
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}

// --- Routes ---------------------------------------------------------------------

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://${HOST}`);
  const path = url.pathname;
  const method = req.method ?? "GET";
  const m = path.match(/^\/api\/runs\/([^/]+)(\/[a-z]+)?$/);
  const id = m?.[1] ? decodeURIComponent(m[1]) : undefined;
  const action = m?.[2];

  if (path === "/api/health" && method === "GET") return sendJson(res, 200, health());

  if (path === "/api/runs" && method === "GET") return sendJson(res, 200, listRuns());

  if (path === "/api/runs" && method === "POST") {
    const { request } = await readJson(req);
    if (!request || typeof request !== "string" || !request.trim()) return sendJson(res, 400, { error: "request is required" });
    const state = createRun(request.trim());
    startRun(state);
    return sendJson(res, 201, summarize(state));
  }

  if (id) {
    if (!validId(id)) return sendJson(res, 404, { error: "run not found" });

    if (!action && method === "GET") return sendJson(res, 200, runDetail(id));

    if (action === "/events" && method === "GET") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(": connected\n\n");
      const a = getActive(id);
      a.clients.add(res);
      const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
      req.on("close", () => {
        clearInterval(ping);
        a.clients.delete(res);
      });
      return;
    }

    if (action === "/answer" && method === "POST") {
      const { questionId, answer } = await readJson(req);
      const a = active.get(id);
      if (!a?.pending || a.pending.id !== questionId) return sendJson(res, 409, { error: "no matching pending question" });
      const pending = a.pending;
      a.pending = undefined;
      const text = String(answer ?? "").trim();
      publish(id, { type: "answer", questionId, text });
      setStatus(id, "running");
      pending.resolve(text);
      return sendJson(res, 200, { ok: true });
    }

    if (action === "/brief" && method === "PUT") {
      const a = active.get(id);
      if (a && (a.status === "running" || a.status === "waiting")) return sendJson(res, 409, { error: "stop the research before adjusting the brief" });
      const edit = await readJson(req);
      const state = loadState(runDir(id));
      const problem = validateBriefEdit(state, edit);
      if (problem) return sendJson(res, 400, { error: problem });
      const { changes, needsRescore } = applyBriefEdit(state, edit);
      if (!changes.length) return sendJson(res, 200, { changes, next: "none" });
      const next = planAfterEdit(state, needsRescore);
      saveState(state);
      publish(id, { type: "log", level: "info", text: `Brief adjusted: ${changes.join("; ")}` });
      if (next !== "none") startRun(state);
      else publish(id, { type: "state" });
      return sendJson(res, 200, { changes, next });
    }

    if (action === "/candidates" && method === "POST") {
      const a = active.get(id);
      if (a && (a.status === "running" || a.status === "waiting")) return sendJson(res, 409, { error: "wait for the research to finish, or stop it, before adding a product" });
      const { name, note } = await readJson(req);
      const state = loadState(runDir(id));
      const result = addUserCandidate(state, String(name ?? ""), String(note ?? ""));
      if ("error" in result) return sendJson(res, 400, { error: result.error });
      saveState(state);
      publish(id, { type: "log", level: "info", text: `You added ${result.name} to the comparison${note ? ` (${note})` : ""}` });
      if (result.start) startRun(state);
      else publish(id, { type: "state" });
      return sendJson(res, 200, { name: result.name, started: result.start });
    }

    if (action === "/stop" && method === "POST") {
      const a = active.get(id);
      if (!a?.controller || (a.status !== "running" && a.status !== "waiting")) return sendJson(res, 409, { error: "run is not running" });
      a.controller.abort();
      a.pending?.reject(new StopError());
      return sendJson(res, 200, { ok: true });
    }

    if (action === "/resume" && method === "POST") {
      const state = loadState(runDir(id));
      if (state.phase === "done") return sendJson(res, 400, { error: "run is already finished" });
      startRun(state);
      return sendJson(res, 200, summarize(state));
    }
  }

  // --- Settings: models and search ---
  if (path === "/api/settings" && method === "GET") return sendJson(res, 200, { settings: settingsView(), presets: PROVIDER_PRESETS, searchOptions: SEARCH_OPTIONS });

  if (path === "/api/settings" && method === "PUT") {
    const update = await readJson(req);
    const problem = validateUpdate(update, loadSettings());
    if (problem) return sendJson(res, 400, { error: problem });
    applyUpdate(update);
    return sendJson(res, 200, { settings: settingsView(), presets: PROVIDER_PRESETS, searchOptions: SEARCH_OPTIONS });
  }

  if (path === "/api/settings/test" && method === "POST") {
    const { target } = await readJson(req);
    if (!["main", "judge", "search"].includes(target)) return sendJson(res, 400, { error: "target must be main, judge or search" });
    return sendJson(res, 200, await testConnection(target));
  }

  if (path === "/api/settings/models" && method === "GET") {
    try {
      return sendJson(res, 200, { models: await listModels(url.searchParams.get("providerId") ?? "") });
    } catch (e) {
      return sendJson(res, 502, { error: (e as Error).message });
    }
  }

  // --- Domain guides ---
  if (path === "/api/domains" && method === "GET") return sendJson(res, 200, listGuides());

  if (path === "/api/domains/draft" && method === "POST") {
    const name = guideName(String((await readJson(req)).name ?? ""));
    if (!name) return sendJson(res, 400, { error: "give the guide a name like 'smartphones' (letters, numbers, dashes)" });
    try {
      return sendJson(res, 200, { name, content: await draftGuide(name) });
    } catch (e) {
      return sendJson(res, 502, { error: (e as Error).message });
    }
  }

  const dm = path.match(/^\/api\/domains\/([^/]+)$/);
  if (dm) {
    const name = guideName(decodeURIComponent(dm[1]));
    if (!name) return sendJson(res, 400, { error: "invalid guide name" });
    if (method === "GET") {
      const content = readGuide(name);
      return content === null ? sendJson(res, 404, { error: "guide not found" }) : sendJson(res, 200, { name, content });
    }
    if (method === "PUT") {
      const { content } = await readJson(req);
      if (typeof content !== "string" || !content.trim()) return sendJson(res, 400, { error: "the guide is empty" });
      if (content.length > 50_000) return sendJson(res, 400, { error: "the guide is too long (keep it under 50,000 characters)" });
      writeGuide(name, content);
      return sendJson(res, 200, { name });
    }
    if (method === "DELETE") return deleteGuide(name) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: "guide not found" });
  }

  if (path === "/api/profile" && method === "GET") return sendJson(res, 200, loadProfile());

  if (path === "/api/profile" && method === "PUT") {
    const body = await readJson(req);
    if (!Array.isArray(body)) return sendJson(res, 400, { error: "expected an array of facts" });
    const now = new Date().toISOString();
    const facts: ProfileFact[] = body
      .filter((f: any) => typeof f?.text === "string" && f.text.trim())
      .map((f: any) => ({
        id: typeof f.id === "string" ? f.id : randomUUID(),
        text: f.text.trim(),
        scope: typeof f.scope === "string" && f.scope.trim() ? f.scope.trim() : undefined,
        source: f.source === "intake" ? "intake" : "user",
        updatedAt: f.updatedAt ?? now,
      }));
    saveProfile(facts);
    return sendJson(res, 200, facts);
  }

  if (path === "/api/profile" && method === "POST") {
    const { text, scope } = await readJson(req);
    if (typeof text !== "string" || !text.trim()) return sendJson(res, 400, { error: "text is required" });
    return sendJson(res, 200, addProfileFacts([{ text, scope: typeof scope === "string" ? scope : undefined }], "user"));
  }

  if (path.startsWith("/api/")) return sendJson(res, 404, { error: "not found" });
  serveStatic(path, res);
}

createServer((req, res) => {
  handle(req, res).catch((e: Error) => {
    if (!res.headersSent) sendJson(res, 500, { error: e.message });
    else res.end();
  });
}).listen(PORT, HOST, () => {
  const h = health();
  console.log(`Product research UI: http://localhost:${PORT}`);
  console.log(`Main model: ${h.mainModel} | judge: ${h.judgeModel} | search: ${h.search}`);
  if (h.missing.length) console.log(`Missing in .env: ${h.missing.join(", ")}`);
});
