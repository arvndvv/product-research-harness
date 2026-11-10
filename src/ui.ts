/** Terminal front end: prints run events and reads answers from stdin. */
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { PendingQuestion, RunEventInput } from "./shared.ts";

let rl: readline.Interface | null = null;

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
export const oneLine = (s: string, max = 140) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 3) + "..." : flat;
};

export async function cliAsk(question: string, opts: Omit<PendingQuestion, "id" | "question"> = {}): Promise<string> {
  rl ??= readline.createInterface({ input: stdin, output: stdout });
  if (opts.details) console.log("\n" + opts.details);
  const hints: string[] = [];
  if (opts.options?.length) hints.push(`options: ${opts.options.join(" / ")}`);
  if (opts.suggestion) hints.push(`suggested: "${opts.suggestion}" (press Enter to accept)`);
  const answer = (await rl.question(`\n${bold(question)}${hints.length ? `\n${dim(hints.join("  |  "))}` : ""}\n> `)).trim();
  return answer || opts.suggestion || "";
}

export function closeIO() {
  rl?.close();
  rl = null;
}

export function printEvent(e: RunEventInput) {
  switch (e.type) {
    case "log":
      console.log(e.level === "dim" ? dim(e.text) : e.level === "warn" ? `! ${e.text}` : e.text);
      break;
    case "phase":
      console.log(`\n${bold(`== ${e.phase.toUpperCase()}${e.round ? ` (round ${e.round})` : ""} ==`)}`);
      break;
    case "status":
      if (e.error) console.log(`! ${e.error}`);
      break;
    default:
      break;
  }
}
