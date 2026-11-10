import assert from "node:assert/strict";
import { test } from "node:test";
import { setChatImpl, type AssistantMessage, type ChatRequest } from "../src/llm.ts";
import { compactHistory, finishTool, runAgent, tool } from "../src/loop.ts";

const call = (id: string, name: string, args: object): AssistantMessage => ({
  role: "assistant",
  content: null,
  tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
});

test("agent loop runs tools, enforces the finish gate, then stops", async () => {
  // Scripted "model": records, tries to finish too early, records again, finishes.
  const script: AssistantMessage[] = [
    call("1", "record", { fact: "a" }),
    call("2", "finish", {}),
    { role: "assistant", content: "Thinking out loud without tools." },
    call("3", "record", { fact: "b" }),
    call("4", "finish", {}),
  ];
  const seen: ChatRequest[] = [];
  setChatImpl(async (req) => {
    seen.push({ ...req, messages: [...req.messages] });
    return script.shift()!;
  });

  const facts: string[] = [];
  const result = await runAgent({
    label: "test",
    system: "sys",
    task: "task",
    tools: [tool("record", "save a fact", { fact: { type: "string" } }, ({ fact }) => (facts.push(fact), "saved"))],
    finish: finishTool("finish", "done", {}, () => (facts.length >= 2 ? null : "need 2 facts"), []),
    maxSteps: 10,
  });

  assert.equal(result.finished, true);
  assert.equal(result.steps, 5);
  assert.deepEqual(facts, ["a", "b"]);

  // The rejection reason was fed back to the model as the tool result.
  const afterReject = seen[2].messages.at(-1)!;
  assert.equal(afterReject.role, "tool");
  assert.match((afterReject as any).content, /NOT ACCEPTED YET: need 2 facts/);

  // A prose-only reply gets a nudge back to the tools.
  const nudge = seen[3].messages.at(-1)!;
  assert.equal(nudge.role, "user");
  assert.match((nudge as any).content, /Continue the task/);
});

test("agent loop reports step-limit exhaustion", async () => {
  setChatImpl(async () => call("x", "noop", {}));
  const result = await runAgent({
    label: "test",
    system: "s",
    task: "t",
    tools: [tool("noop", "nothing", {}, () => "ok", [])],
    finish: finishTool("finish", "done", {}, () => null, []),
    maxSteps: 3,
  });
  assert.equal(result.finished, false);
});

test("compactHistory trims old tool output but keeps recent", () => {
  const big = "x".repeat(5000);
  const messages: any[] = [
    { role: "system", content: "s" },
    { role: "tool", tool_call_id: "1", name: "fetch_page", content: big },
    ...Array.from({ length: 10 }, (_, i) => ({ role: "tool", tool_call_id: `r${i}`, name: "fetch_page", content: big })),
  ];
  compactHistory(messages, 10, 500);
  assert.ok(messages[1].content.length < 700);
  assert.equal(messages.at(-1).content.length, 5000);
});

test("an agent repeating a rejected finish without progress is stopped early", async () => {
  let calls = 0;
  setChatImpl(async () => {
    calls++;
    return call(`s${calls}`, "finish", {});
  });
  const result = await runAgent({
    label: "t",
    system: "s",
    task: "t",
    tools: [],
    finish: finishTool("finish", "done", {}, () => "need more", []),
    maxSteps: 25,
  });
  assert.equal(result.finished, false);
  assert.equal(calls, 4);
});
