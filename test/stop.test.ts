import assert from "node:assert/strict";
import { test } from "node:test";
import { StopError, withIO } from "../src/context.ts";
import { setChatImpl } from "../src/llm.ts";
import { finishTool, runAgent, tool } from "../src/loop.ts";

test("Stop ends an agent loop between steps with StopError", async () => {
  const controller = new AbortController();
  let calls = 0;
  setChatImpl(async () => {
    calls++;
    if (calls === 3) controller.abort(); // person presses Stop while the model works
    return { role: "assistant", content: null, tool_calls: [{ id: `c${calls}`, type: "function", function: { name: "noop", arguments: "{}" } }] };
  });
  const io = { ask: async () => "", emit: () => {}, trace: () => {}, signal: controller.signal };
  await assert.rejects(
    withIO(io, () =>
      runAgent({ label: "t", system: "s", task: "t", tools: [tool("noop", "n", {}, () => "ok", [])], finish: finishTool("finish", "f", {}, () => null, []), maxSteps: 50 }),
    ),
    (e) => e instanceof StopError,
  );
  assert.equal(calls, 3);
});
