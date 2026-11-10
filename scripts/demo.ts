/**
 * Demo mode: the real server and UI, driven by a scripted fake model.
 * No API keys, no web requests. Data goes to demo-runs/ and demo-memory/.
 *
 *   npm run demo   ->  http://localhost:4321
 *
 * Also a good read: it shows exactly what the harness expects from a model
 * (which tool calls, in which order, with which arguments).
 */
process.env.RUNS_DIR ??= "demo-runs";
process.env.MEMORY_DIR ??= "demo-memory";
process.env.KNOWLEDGE_DIR ??= "demo-knowledge";
process.env.SETTINGS_FILE ??= "demo-settings.json";
process.env.LLM_API_KEY ||= "demo";
process.env.TAVILY_API_KEY ||= "demo";

const { installDemoModel } = await import("./demo-model.ts");
installDemoModel();

await import("../src/server.ts");
console.log("DEMO MODE: scripted fake model, no API calls. Data in demo-runs/ and demo-memory/.");
