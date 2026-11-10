import { useEffect, useState } from "react";
import type { RunDetail } from "../../../src/shared.ts";

const PHASE_TEXT: Record<string, string> = {
  intake: "Preparing the next question",
  discover: "Searching for products that could fit",
  shortlist: "Choosing which products to research in depth",
  research: "Researching products",
  score: "Scoring products against your criteria",
  critique: "Checking the decision for weak spots",
  report: "Writing your recommendation",
};

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

const ago = (s: number) => (s < 5 ? "just now" : s < 60 ? `${Math.floor(s)}s ago` : `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s ago`);

/**
 * Shown while a run is working: what it's doing right now, progress through
 * the products, and a heartbeat ("last update 4s ago") so a slow step never
 * looks like a frozen app.
 */
export default function WorkingPanel({ detail }: { detail: RunDetail }) {
  const now = useNow();
  const { state, events } = detail;

  const logs = events.filter((e) => e.type === "log");
  const last = events.at(-1);
  const secondsSince = last ? (now - new Date(last.t).getTime()) / 1000 : 0;

  // "Researching 3/6: Product" is logged at the start of each product.
  let item: { i: number; n: number; name: string } | null = null;
  if (state.phase === "research") {
    for (let k = logs.length - 1; k >= 0; k--) {
      const e = logs[k];
      if (e.type !== "log") continue;
      const m = e.text.match(/^Researching (\d+)\/(\d+): (.+)$/);
      if (m) {
        item = { i: Number(m[1]), n: Number(m[2]), name: m[3] };
        break;
      }
    }
  }
  const latest = [...logs].reverse().find((e) => e.type === "log" && !e.text.includes("|"));
  const latestText = latest?.type === "log" ? latest.text.replace(/^\[[^\]]+\]\s*/, "") : "Starting...";
  const prices = state.prices?.length ?? 0;
  const slow = secondsSince > 75;

  return (
    <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <span className="relative mt-1 flex h-3 w-3 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="font-medium text-zinc-900">
              {PHASE_TEXT[state.phase] ?? "Working"}
              {item && (
                <span className="text-zinc-500">
                  {" "}
                  · {item.i} of {item.n}: <span className="text-zinc-800">{item.name}</span>
                </span>
              )}
            </div>
            <div className={slow ? "text-xs text-amber-700" : "text-xs text-zinc-400"}>last update {ago(secondsSince)}</div>
          </div>

          {item && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${((item.i - 0.5) / item.n) * 100}%` }} />
            </div>
          )}

          <p className="mt-3 truncate font-mono text-xs text-zinc-500" title={latestText}>
            {latestText}
          </p>

          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500">
            <span>{state.candidates.length} products found</span>
            <span>{state.evidence.length} findings</span>
            <span>{prices} prices checked</span>
            {state.round > 0 && <span>extra research round {state.round}</span>}
          </div>

          {slow && (
            <p className="mt-3 text-xs text-amber-700">
              Waiting on the model or a slow website. This is normal on rate-limited API plans; it will continue on its own.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
