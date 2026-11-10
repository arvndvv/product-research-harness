/**
 * The scripted fake model used by demo mode (and by `npm run stability` with
 * DEMO_MODEL=1). It returns the tool calls and JSON a real model would, with
 * no API calls. A good read to see exactly what the harness expects.
 */
import { setChatImpl, type AssistantMessage, type ChatRequest } from "../src/llm.ts";
import { rememberPage } from "../src/tools/web.ts";

const DELAY_MS = Number(process.env.DEMO_DELAY_MS ?? 350);
let n = 0;
const call = (name: string, args: object): AssistantMessage => ({
  role: "assistant",
  content: null,
  tool_calls: [{ id: `d${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
});
const json = (v: object): AssistantMessage => ({ role: "assistant", content: JSON.stringify(v) });
const stepOf = (req: ChatRequest) => req.messages.filter((m) => m.role === "assistant").length;
const lastTool = (req: ChatRequest) => {
  const m = req.messages.at(-1);
  return m?.role === "tool" ? m.content : "";
};

const PRODUCTS = ["Trailblazer Grip 3", "CityStride Comfort", "Courtline All-Rounder", "AeroWalk Mesh 2", "PaceFlex Daily", "TurfMaster Pro"];
const CRITERIA = ["grip", "comfort", "breathability", "durability"];
const SITES = ["https://www.reddit.com/r/RunningShoeGeeks/comments/demo", "https://reviews.example.com/p", "https://specs.example.org/s", "https://shop.example.in/item"];

// Pages the fake researcher "reads": quotes are verified against these, as in a real run.
const DEMO_SENTENCE = "Tested in real conditions over several weeks of daily use.";
for (const site of SITES) for (let i = 0; i < 12; i++) rememberPage(`${site}/${i}`, `Demo review page. ${DEMO_SENTENCE}`);
rememberPage("https://lab.example.com/weights", "Trailblazer Grip 3 weighs 260 g. CityStride Comfort weighs 240 g. Courtline All-Rounder weighs 300 g. AeroWalk Mesh 2 weighs 230 g. Other shoes tested: weighs 270 g.");
rememberPage("https://lab.example.com/durability", "Outsole life 650 km (Trailblazer Grip 3), outsole life 500 km (CityStride Comfort), outsole life 700 km (Courtline All-Rounder), outsole life 350 km (AeroWalk Mesh 2).");
rememberPage("https://shop.example.in/item", "Trailblazer Grip 3 price ₹4,199. CityStride Comfort price ₹3,499. Courtline All-Rounder price ₹6,299. AeroWalk Mesh 2 price ₹2,799. Other models price ₹3,999.");

function fakeModel(req: ChatRequest): AssistantMessage {
  const system = req.messages[0].content as string;
  const tools = req.tools?.map((t) => t.function.name) ?? [];
  const step = stepOf(req);

  // Settings page: "Test research model" sends a tiny tool-call check.
  if (String(req.messages[0].content).startsWith("Call the ping tool")) return call("ping", { word: "ok" });

  // Domain guides page: "Draft with AI".
  if (system.includes("You write a short domain guide")) {
    const cat = String(req.messages[1].content).replace("Category: ", "");
    return {
      role: "assistant",
      content: `# Domain guide: ${cat}\n\n## What actually matters\n- (demo draft) The factors that separate good from bad ${cat}.\n\n## Sources\n- Lab tests and specialist reviewers.\n\n## Pitfalls\n- Similar model names across generations.`,
    };
  }

  if (system.includes("You run the intake interview")) {
    // Code-controlled interview: one JSON turn at a time.
    const user = req.messages[1].content as string;
    const asked = (user.match(/^Q\d+[ :(]/gm) ?? []).length;
    const size = user.split("Interview so far")[0].match(/shoe size: ([^\n]+)/i)?.[1]?.trim();
    const known = [{ topic: "use", value: "cricket + walking", source: "said" }];
    const questions = [
      { question: "Where do you play: turf, concrete nets, or a grass ground?", why_it_matters: "decides outsole type", resolves: "surface", options: ["Turf", "Concrete nets", "Grass ground", "All of these"] },
      { question: "What size do you wear?", why_it_matters: "availability", resolves: "size", suggested_answer: size, options: size ? undefined : ["UK 7", "UK 8", "UK 9"] },
      { question: "What's your budget?", why_it_matters: "filters the shortlist", resolves: "budget", options: ["Under ₹3,000", "Under ₹5,000", "Under ₹8,000"] },
    ];
    if (asked < questions.length) return json({ known, next_question: questions[asked], requirements: null });
    return json({
      known,
      next_question: null,
      requirements: {
        category: "multi-use shoes",
        summary: "Plays weekend cricket and walks a lot on city roads; wants one comfortable pair for both.",
        use_case: "Cricket on turf 1-2x a week, daily walks on tar/cement",
        budget_max: 5000,
        currency: "INR",
        budget_flex_percent: 0,
        budget_notes: "",
        region: "India",
        must_haves: ["good grip on turf and concrete", "comfortable for long wear"],
        nice_to_haves: ["breathable upper"],
        dealbreakers: ["needs a long break-in"],
        criteria: CRITERIA.map((name, i) => ({ name, weight: [35, 30, 20, 15][i], description: `Strong ${name} for turf + road use` })),
        assumptions: ["No preference on brand"],
      },
      profile_updates: [
        { fact: "country: India", scope: "" },
        { fact: "currency: INR", scope: "" },
        { fact: `shoe size: ${size ?? "UK 7"}`, scope: "shoes" },
        { fact: "plays: weekend cricket", scope: "" },
      ],
    });
  }

  if (tools.includes("add_candidate")) {
    if (step < PRODUCTS.length) {
      const name = PRODUCTS[step];
      return call("add_candidate", { name, approx_price: `₹${(2500 + step * 450).toLocaleString("en-IN")}`, why: "Recommended for mixed turf and road use", source_url: `${SITES[step % 4]}/${step}` });
    }
    return call("finish_longlist", { notes: "done" });
  }

  if (tools.includes("record_evidence")) {
    const followup = (req.messages[1].content as string).startsWith("Follow-up");
    const product = (req.messages[1].content as string).match(/"([^"]+)"/)?.[1] ?? "product";
    if (!followup && step === 0) {
      const amount = { "Trailblazer Grip 3": 4199, "CityStride Comfort": 3499, "Courtline All-Rounder": 6299, "AeroWalk Mesh 2": 2799 }[product] ?? 3999;
      return call("record_price", { amount, currency: "INR", kind: "sale", seller: "shop.example.in", url: "https://shop.example.in/item", source_type: "retailer", quote: `price ₹${amount.toLocaleString("en-IN")}` });
    }
    // Then the planned measurements, with the same (demo) source for every product.
    const lab: Record<string, [number, number]> = { "Trailblazer Grip 3": [260, 650], "CityStride Comfort": [240, 500], "Courtline All-Rounder": [300, 700], "AeroWalk Mesh 2": [230, 350] };
    if (!followup && (step === 1 || step === 2)) {
      const [grams, km] = lab[product] ?? [270, 500];
      return step === 1
        ? call("record_metric", { metric: "weight_g", value: grams, source_url: "https://lab.example.com/weights", quote: `weighs ${grams} g` })
        : call("record_metric", { metric: "outsole_life_km", value: km, source_url: "https://lab.example.com/durability", quote: `outsole life ${km} km` });
    }
    const total = followup ? 2 : 10;
    if (step < total) {
      const s = followup ? step : step - 2; // evidence steps 3..9 -> s = 1..7, after the price and two measurements
      const criterion = followup ? CRITERIA[3] : s <= 4 ? CRITERIA[s - 1] ?? CRITERIA[0] : s === 5 ? "general" : CRITERIA[s % 4];
      const sentiment = s === 3 ? "mixed" : s === 6 ? "negative" : "positive";
      return call("record_evidence", {
        criterion,
        finding:
          criterion === "general"
            ? `${product} is sold on Indian marketplaces at around ₹4,200, sizes UK 6-11.`
            : `${sentiment === "negative" ? "Several owners report" : "Testers note"} ${criterion} ${sentiment === "negative" ? "drops after ~4 months of turf use" : "is better than average for this price"} (demo finding).`,
        sentiment,
        source_url: `${SITES[(s + 3) % 4]}/${step}`,
        source_type: (s + 3) % 4 === 0 ? "community" : (s + 3) % 4 === 1 ? "expert_review" : (s + 3) % 4 === 2 ? "spec" : "retailer",
        quote: DEMO_SENTENCE,
      });
    }
    return call("finish_research", { summary: "Good coverage across criteria (demo)." });
  }

  if (system.includes("pick which products")) {
    return json({ shortlist: PRODUCTS.slice(0, 4).map((name) => ({ name, reason: "fits the brief" })), cut: PRODUCTS.slice(4).map((name) => ({ name, reason: "near-duplicate of a shortlisted pair" })) });
  }

  if (system.includes("You define OBJECTIVE")) {
    return json({
      criteria: CRITERIA.map((c) => ({
        criterion: c,
        metrics:
          c === "comfort"
            ? [{ key: "weight_g", label: "Weight (UK 8)", unit: "g", higher_is_better: false, poor: 350, good: 220, source_hint: "lab weighing (demo)", source_domain: "lab.example.com" }]
            : c === "durability"
              ? [{ key: "outsole_life_km", label: "Outsole life", unit: "km", higher_is_better: true, poor: 300, good: 800, source_hint: "lab abrasion test (demo)", source_domain: "lab.example.com" }]
              : [],
      })),
    });
  }

  if (system.includes("check ONE product against")) {
    return json({ must_haves: [], dealbreakers_hit: [] });
  }

  if (system.includes("compare products on ONE criterion")) {
    const user = req.messages[1].content as string;
    const names = [...user.matchAll(/^### (.+)$/gm)].map((m) => m[1]);
    const crit = system.match(/Criterion: ([^.]+)\./)?.[1] ?? "";
    const base: Record<string, number> = { "Trailblazer Grip 3": 8, "CityStride Comfort": 7, "Courtline All-Rounder": 6, "AeroWalk Mesh 2": 5 };
    return json({
      scores: names.map((n) => ({ product: n, score: Math.min(10, (base[n] ?? 6) + (crit === "breathability" ? 1 : 0)), rationale: `Compared side by side on ${crit} (demo) E1.` })),
    });
  }

  if (system.includes("skeptical senior reviewer")) {
    const round = Number((req.messages[1].content as string).match(/Round (\d+)/)?.[1] ?? 1);
    if (round === 1)
      return json({ verdict: "iterate", notes: "Leader's durability evidence is thin.", research_tasks: [{ candidate: "Trailblazer Grip 3", question: "How does the outsole hold up after months of turf use?" }], new_candidates: [] });
    return json({ verdict: "done", notes: "Decision is solid.", research_tasks: [], new_candidates: [] });
  }

  if (system.includes("final recommendation")) {
    return {
      role: "assistant",
      content:
        "```markdown\n## Recommendation: Trailblazer Grip 3\nBest balance of grip and comfort for turf plus road use [E1].\n\n## What you give up\nDurability on turf is average [E6].\n\n## Runner-up: CityStride Comfort\nChoose it if you walk far more than you play.\n\n## What would change this recommendation\nIf you start playing 3+ times a week, get a dedicated cricket shoe.\n\n## Buying notes\nAround ₹4,200 on Indian marketplaces (demo).\n```",
    };
  }

  void lastTool;
  throw new Error(`demo model got an unexpected request: ${system.slice(0, 80)}`);
}

export function installDemoModel() {
  setChatImpl(async (req) => {
    await new Promise((r) => setTimeout(r, DELAY_MS));
    return fakeModel(req);
  });
}
