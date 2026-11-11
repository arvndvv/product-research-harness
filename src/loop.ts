/**
 * The agent loop: the heart of any harness.
 *
 *   send messages -> model replies -> if it called tools, run them and send
 *   results back -> repeat until it calls the finish tool AND the gate passes.
 *
 * Two ideas here that matter more than the loop itself:
 *
 * 1. Gated finish. The model cannot just decide it's "done". Finishing is a
 *    tool call, and code checks it against hard requirements (enough sources,
 *    every criterion covered...). If the check fails, the model gets the reason
 *    back as the tool result and has to keep working. This is what stops the
 *    "answers fast, researches shallow" behaviour of chat apps.
 *
 * 2. Context compaction. Old tool outputs (whole web pages) are trimmed, because
 *    the important facts were already saved via tools. Without this, context
 *    fills up and quality drops on long tasks.
 */
import { chat, type ChatMessage, type ToolSpec } from "./llm.ts";
import { log, StopError, throwIfStopped } from "./context.ts";
import { oneLine } from "./ui.ts";

export type Tool = {
  spec: ToolSpec;
  run: (args: any) => Promise<string> | string;
};

export type FinishTool = {
  spec: ToolSpec;
  /** Return null to accept, or a reason string to reject and keep going. */
  check: (args: any) => Promise<string | null> | string | null;
};

export type AgentResult = { finished: boolean; steps: number; finishArgs?: any };

/** Small helper to declare a tool with a JSON-schema for its arguments. */
export function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  run: Tool["run"],
  required: string[] = Object.keys(properties),
): Tool {
  return {
    spec: { type: "function", function: { name, description, parameters: { type: "object", properties, required } } },
    run,
  };
}

/**
 * A tool that records several items in one call (findings, prices). Each model
 * call resends the whole conversation, so batching is a direct cost saving.
 * Accepts {[listKey]: [...items]} or, for compatibility, a single item's fields.
 */
export function batchTool(
  name: string,
  description: string,
  listKey: string,
  itemProperties: Record<string, unknown>,
  recordOne: (item: any) => string,
  after: () => string = () => "",
): Tool {
  return tool(
    name,
    `${description} Record several at once when you have them: one call with a list is cheaper than many calls.`,
    { [listKey]: { type: "array", items: { type: "object", properties: itemProperties, required: Object.keys(itemProperties) } } },
    (args) => {
      const items: any[] = Array.isArray(args?.[listKey]) ? args[listKey] : [args];
      if (!items.length) return `ERROR: ${listKey} is empty.`;
      const results = items.map((it, i) => (items.length > 1 ? `${i + 1}. ` : "") + recordOne(it ?? {}));
      const tail = after();
      return `${results.join("\n")}${tail ? `\n${tail}` : ""}`;
    },
  );
}

export function finishTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  check: FinishTool["check"],
  required: string[] = Object.keys(properties),
): FinishTool {
  return {
    spec: { type: "function", function: { name, description, parameters: { type: "object", properties, required } } },
    check,
  };
}

/** Short human-readable view of tool arguments for the activity log. */
function describeArgs(args: any): string {
  if (args && typeof args === "object") {
    const main = args.query ?? args.url ?? args.question ?? args.name ?? args.finding;
    if (typeof main === "string") return `"${oneLine(main, 140)}"`;
  }
  return oneLine(JSON.stringify(args), 140);
}

const TRIM_NOTE = "\n[...older tool output trimmed to save context; key facts should already be recorded]";

/** Trim long tool outputs except the most recent ones. */
export function compactHistory(messages: ChatMessage[], keepRecent = 4, maxOldChars = 300) {
  for (let i = 0; i < messages.length - keepRecent; i++) {
    const m = messages[i];
    if (m.role === "tool" && m.content.length > maxOldChars && !m.content.endsWith(TRIM_NOTE)) {
      m.content = m.content.slice(0, maxOldChars) + TRIM_NOTE;
    }
  }
}

export async function runAgent(opts: {
  label: string;
  system: string;
  task: string;
  tools: Tool[];
  finish: FinishTool;
  maxSteps: number;
}): Promise<AgentResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.task },
  ];
  const toolsByName = new Map(opts.tools.map((t) => [t.spec.function.name, t]));
  const specs = [...opts.tools.map((t) => t.spec), opts.finish.spec];
  const finishName = opts.finish.spec.function.name;
  const tag = `[${opts.label}]`;
  // An agent that keeps calling finish without doing anything in between is
  // stuck: stop it early instead of burning the remaining steps.
  let stuckRejections = 0;

  for (let step = 1; step <= opts.maxSteps; step++) {
    throwIfStopped();
    compactHistory(messages);
    const reply = await chat({ messages, tools: specs });
    messages.push(reply);

    if (reply.content?.trim()) log(`${tag} ${oneLine(reply.content, 300)}`, "dim");

    // Model answered in prose instead of acting. Nudge it back to the tools.
    if (!reply.tool_calls?.length) {
      messages.push({
        role: "user",
        content: `Continue the task using the tools. When the work is complete, call ${finishName}.`,
      });
      continue;
    }

    let accepted = false;
    let finishArgs: any;
    for (const call of reply.tool_calls) {
      const name = call.function.name;
      let result: string;
      let args: any;
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = undefined;
      }

      if (args === undefined) {
        result = "ERROR: tool arguments were not valid JSON. Call the tool again with valid JSON arguments.";
      } else if (name === finishName) {
        const problem = await opts.finish.check(args);
        if (problem) {
          stuckRejections++;
          result = `NOT ACCEPTED YET: ${problem}`;
          log(`${tag} ${name} not accepted: ${oneLine(problem, 300)}`, "warn");
        } else {
          accepted = true;
          finishArgs = args;
          result = "Accepted.";
          log(`${tag} ${name} accepted`, "ok");
        }
      } else {
        const t = toolsByName.get(name);
        log(`${tag} ${name} ${describeArgs(args)}`, "dim");
        stuckRejections = 0;
        try {
          result = t ? await t.run(args) : `ERROR: unknown tool "${name}".`;
        } catch (e) {
          if (e instanceof StopError) throw e;
          throwIfStopped(); // an aborted fetch means Stop was pressed
          // Tool errors go back to the model as text, so it can adapt
          // (try another URL, another query) instead of crashing the run.
          result = `ERROR: ${(e as Error).message}`;
        }
      }
      // Every tool call must get exactly one tool result message.
      messages.push({ role: "tool", tool_call_id: call.id, name, content: result });
    }

    if (accepted) return { finished: true, steps: step, finishArgs };
    if (stuckRejections >= 4) {
      log(`${tag} stuck: asked to finish ${stuckRejections} times without making progress; stopping this agent`, "warn");
      return { finished: false, steps: step };
    }
  }

  log(`${tag} step limit (${opts.maxSteps}) reached`, "warn");
  return { finished: false, steps: opts.maxSteps };
}
