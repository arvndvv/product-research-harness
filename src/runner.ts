/**
 * The orchestrator, shared by the CLI and the web server.
 *
 * The overall shape is a WORKFLOW (code decides the order of phases), with
 * AGENT LOOPS inside the phases that need open-ended exploration.
 *
 *   intake -> discover -> shortlist -> research -> score -> critique
 *                                         ^                      |
 *                                         +------ iterate -------+
 *                                                                |
 *                                                     done ---> report
 */
import { emit, log, throwIfStopped } from "./context.ts";
import { critiquePhase } from "./phases/critique.ts";
import { discoverPhase, shortlistPhase } from "./phases/discover.ts";
import { intakePhase } from "./phases/intake.ts";
import { reportPhase } from "./phases/report.ts";
import { researchPhase } from "./phases/research.ts";
import { scorePhase } from "./phases/score.ts";
import { logEvent, saveState, type Phase, type RunState } from "./state.ts";

const PHASES: Record<Exclude<Phase, "done">, (s: RunState) => Promise<void>> = {
  intake: intakePhase,
  discover: discoverPhase,
  shortlist: shortlistPhase,
  research: researchPhase,
  score: scorePhase,
  critique: critiquePhase,
  report: reportPhase,
};

export async function runPipeline(state: RunState) {
  while (state.phase !== "done") {
    throwIfStopped();
    emit({ type: "phase", phase: state.phase, round: state.round });
    const started = Date.now();
    await PHASES[state.phase](state);
    logEvent(state, { type: "phase_done", ms: Date.now() - started });
    saveState(state);
  }
  log(`Done. Report: ${state.reportPath}`, "ok");
}
