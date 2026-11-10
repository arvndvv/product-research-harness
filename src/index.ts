/**
 * Command-line front end. (The web UI is src/server.ts: `npm run app`.)
 *
 * Usage:
 *   npm start                          (asks what you want to buy)
 *   npm start -- "trail running shoes"
 *   npm start -- --resume runs/<run-folder>
 */
import { llmTarget, searchSettings } from "./settings.ts";
import { withIO } from "./context.ts";
import { runPipeline } from "./runner.ts";
import { createRun, loadState, logEvent, saveState, type RunState } from "./state.ts";
import { cliAsk, closeIO, printEvent } from "./ui.ts";

let current: RunState | undefined;

async function main() {
  const args = process.argv.slice(2);
  const resumeAt = args.indexOf("--resume");

  if (resumeAt >= 0) {
    const dir = args[resumeAt + 1];
    if (!dir) throw new Error("Usage: npm start -- --resume runs/<run-folder>");
    current = loadState(dir);
    console.log(`Resuming ${current.id} at phase "${current.phase}"`);
  } else {
    const request = args.join(" ").trim() || (await cliAsk("What are you looking to buy? Describe it in your own words."));
    if (!request) throw new Error("Nothing to research.");
    current = createRun(request);
    console.log(`Run folder: ${current.dir}  (open notes.md there to watch progress)`);
  }

  const state = current;
  const main = llmTarget("main");
  const judge = llmTarget("judge");
  console.log(`Main model: ${main.model} @ ${main.baseUrl}`);
  if (judge.model !== main.model || judge.baseUrl !== main.baseUrl) console.log(`Judge model: ${judge.model} @ ${judge.baseUrl}`);
  console.log(`Search: ${searchSettings().provider}  (change in the app: Profile > Models & search, or settings.json)`);

  await withIO({ ask: cliAsk, emit: printEvent, trace: (e) => logEvent(state, e) }, () => runPipeline(state));
}

main()
  .catch((e) => {
    console.error(`\nError: ${(e as Error).message}`);
    if (current) {
      saveState(current);
      console.error(`Progress is saved. Resume with: npm start -- --resume ${current.dir}`);
    }
    process.exitCode = 1;
  })
  .finally(closeIO);
