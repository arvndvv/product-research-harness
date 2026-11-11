/**
 * LLM client. Talks to any OpenAI-compatible /chat/completions endpoint
 * (Mistral, OpenAI, Ollama, LM Studio, OpenRouter, vLLM...).
 *
 * The harness never imports a vendor SDK. Swapping models = changing .env.
 */
import { config } from "./config.ts";
import { chargeUsage, checkBudget, log, requestSignal, sleep, throwIfStopped, trace } from "./context.ts";
import { llmTarget } from "./settings.ts";

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

export type AssistantMessage = Extract<ChatMessage, { role: "assistant" }>;

export type ToolSpec = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ChatRequest = {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** Ask the API for a JSON object instead of free text. */
  json?: boolean;
  temperature?: number;
  /** Which model profile to use (see config.ts). Default: main. */
  profile?: ModelProfile;
};

export type ModelProfile = "main" | "judge";

export type ChatFn = (req: ChatRequest) => Promise<AssistantMessage>;

// Every model call is traced to runs/<id>/log.jsonl (via the run context),
// so it can be inspected afterwards. Observability is half of harness work.

// Some models return content as an array of chunks (e.g. reasoning models).
function contentToText(content: unknown): string | null {
  if (content == null) return null;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === "string" ? part : part?.type === "text" ? part.text : ""))
      .join("");
  }
  return String(content);
}

async function httpChat(req: ChatRequest): Promise<AssistantMessage> {
  const profile = req.profile ?? "main";
  // Read on every call: changing models in Settings takes effect immediately.
  const llm = llmTarget(profile);
  if (!llm.baseUrl || !llm.model) {
    throw new Error(`No ${profile === "judge" ? "judge" : "research"} model is set. Choose one in Profile > Models & search.`);
  }
  const body: Record<string, unknown> = {
    model: llm.model,
    messages: req.messages,
    temperature: req.temperature ?? 0.3,
  };
  if (req.tools?.length) {
    body.tools = req.tools;
    body.tool_choice = "auto";
  }
  if (req.json) body.response_format = { type: "json_object" };

  checkBudget();
  for (let attempt = 1; ; attempt++) {
    throwIfStopped();
    const started = Date.now();
    const res = await fetch(`${llm.baseUrl}/chat/completions`, {
      method: "POST",
      // Local servers (Ollama, LM Studio) don't need a key.
      headers: { "Content-Type": "application/json", ...(llm.apiKey ? { Authorization: `Bearer ${llm.apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: requestSignal(config.llm.timeoutMs),
    }).catch((e) => {
      throwIfStopped(); // a Stop aborts the request: report it as a stop, not a network error
      throw e;
    });

    if (res.ok) {
      const data: any = await res.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error(`LLM returned no message: ${JSON.stringify(data).slice(0, 500)}`);
      const toolCalls: ToolCall[] | undefined = msg.tool_calls?.length
        ? msg.tool_calls.map((tc: any) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.function.name,
              arguments:
                typeof tc.function.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function.arguments ?? {}),
            },
          }))
        : undefined;
      const reply: AssistantMessage = { role: "assistant", content: contentToText(msg.content), tool_calls: toolCalls };
      chargeUsage({ model: llm.model, baseUrl: llm.baseUrl, usage: data.usage });
      trace({
        type: "llm",
        profile,
        model: llm.model,
        ms: Date.now() - started,
        usage: data.usage,
        request: { messageCount: req.messages.length, tools: req.tools?.map((t) => t.function.name), json: !!req.json },
        reply,
      });
      return reply;
    }

    // Rate limits and server errors are normal at scale: back off and retry.
    const text = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    trace({ type: "llm_error", profile, model: llm.model, status: res.status, body: text.slice(0, 1000), attempt });
    if (!retryable || attempt >= 5) throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 500)}`);
    const waitMs = Math.min(30_000, 1000 * 2 ** attempt);
    log(`model API returned ${res.status}, retrying in ${waitMs / 1000}s`, "warn");
    await sleep(waitMs);
  }
}

let impl: ChatFn = httpChat;
/** Swap the model implementation. Tests use this to script fake replies. */
export function setChatImpl(fn: ChatFn) {
  impl = fn;
}
export const chat: ChatFn = (req) => impl(req);

/** Pull a JSON object out of a reply, tolerating ```json fences or stray prose. */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object found");
  return body.slice(start, end + 1);
}

/**
 * Structured output: ask for JSON, validate it, and if it's wrong tell the
 * model exactly what's wrong and let it retry. Validation in code + a repair
 * loop is far more reliable than hoping the prompt is followed.
 */
export async function chatJSON<T>(
  messages: ChatMessage[],
  opts: { validate?: (value: any) => string | null; temperature?: number; profile?: ModelProfile; label?: string } = {},
): Promise<T> {
  const history = [...messages];
  let lastProblem = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const reply = await chat({ messages: history, json: true, temperature: opts.temperature ?? 0, profile: opts.profile });
    const text = reply.content ?? "";
    let parsed: any;
    let problem: string | null;
    try {
      parsed = JSON.parse(extractJson(text));
      problem = opts.validate ? opts.validate(parsed) : null;
    } catch (e) {
      problem = `invalid JSON (${(e as Error).message})`;
    }
    if (!problem) return parsed as T;
    lastProblem = problem;
    log(`${opts.label ?? "model reply"}: ${problem}${attempt < 3 ? ", asking the model to fix it" : ""}`, "warn");
    history.push(
      { role: "assistant", content: text },
      { role: "user", content: `That JSON has a problem: ${problem}. Reply again with the corrected JSON object only.` },
    );
  }
  // Say what was wrong: "invalid JSON" and "valid JSON with a missing field" need different fixes.
  throw new Error(`${opts.label ?? "The model"} gave an unusable answer 3 times. Last problem: ${lastProblem}`);
}
