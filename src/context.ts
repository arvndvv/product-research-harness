/**
 * Per-run I/O context.
 *
 * The harness code never talks to a terminal or a browser directly. It calls
 * log(), ask() and trace(), and whatever front end started the run decides
 * what those mean:
 *   - CLI:    print to the console, read answers from stdin
 *   - server: stream events to the web UI, wait for an answer from the browser
 *
 * AsyncLocalStorage carries the current run's IO through every await, so
 * several runs can be in flight at once without passing an `io` parameter
 * through every function.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { LogLevel, PendingQuestion, RunEventInput } from "./shared.ts";
import { cliAsk, printEvent } from "./ui.ts";

export type AskOptions = Omit<PendingQuestion, "id" | "question">;

export type RunIO = {
  ask(question: string, opts?: AskOptions): Promise<string>;
  emit(event: RunEventInput): void;
  /** Low-level diagnostics (model calls etc.), written to log.jsonl. */
  trace(event: Record<string, unknown>): void;
  /** Aborted when the person presses Stop. */
  signal?: AbortSignal;
};

/** Thrown when a run is stopped on purpose. Progress is saved; Resume continues. */
export class StopError extends Error {
  constructor() {
    super("Stopped by you");
    this.name = "StopError";
  }
}

const fallback: RunIO = { ask: cliAsk, emit: printEvent, trace: () => {} };
const storage = new AsyncLocalStorage<RunIO>();

export function withIO<T>(io: RunIO, fn: () => Promise<T>): Promise<T> {
  return storage.run(io, fn);
}

const currentIO = (): RunIO => storage.getStore() ?? fallback;

export const log = (text: string, level: LogLevel = "info") => currentIO().emit({ type: "log", level, text });
export const ask = (question: string, opts?: AskOptions) => currentIO().ask(question, opts);
export const emit = (event: RunEventInput) => currentIO().emit(event);
export const trace = (event: Record<string, unknown>) => currentIO().trace(event);

/**
 * Cancellation. The loop calls throwIfStopped() between steps; network calls
 * use requestSignal() so an in-flight model call or page fetch ends at once.
 */
export function throwIfStopped() {
  if (currentIO().signal?.aborted) throw new StopError();
}

export function requestSignal(timeoutMs: number): AbortSignal {
  const stop = currentIO().signal;
  const timeout = AbortSignal.timeout(timeoutMs);
  return stop ? AbortSignal.any([timeout, stop]) : timeout;
}

/** Sleep that ends early (with StopError) if the run is stopped. */
export function sleep(ms: number): Promise<void> {
  const stop = currentIO().signal;
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    stop?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new StopError());
    }, { once: true });
  });
}
