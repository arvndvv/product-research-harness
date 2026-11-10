import { useState } from "react";
import type { Health } from "../../../src/shared.ts";
import { api } from "../api.ts";
import { Button } from "./ui.tsx";

const EXAMPLES = [
  "Running shoes for daily 5 km runs on roads",
  "Wireless earbuds for calls and the gym",
  "Laptop for frontend development",
  "Air purifier for a small bedroom",
  "Office chair for long work-from-home days",
];

export default function NewResearch({ health, onStarted }: { health: Health | null; onStarted: (id: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const run = await api.startRun(text.trim());
      onStarted(run.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-8 pb-16 pt-24">
      <h1 className="text-3xl font-semibold tracking-tight">What are you looking to buy?</h1>
      <p className="mt-2 text-zinc-600">
        Describe it in your own words. You'll be asked a few questions first (answers it can guess from your profile are pre-filled),
        then it researches reviews and owner discussions and recommends the one that fits you best.
      </p>

      {health?.missing.length ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Before the first research, set up {health.missing.join(", ")}.{" "}
          <a href="#/settings" className="font-medium underline">
            Open Models &amp; search settings
          </a>
        </div>
      ) : null}

      <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm focus-within:border-zinc-400">
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              start();
            }
          }}
          rows={3}
          placeholder="e.g. shoes I can use for cricket on weekends and long walks, under ₹5,000"
          className="w-full resize-none bg-transparent px-3 py-2 text-base outline-none placeholder:text-zinc-400"
        />
        <div className="flex items-center justify-end px-1 pb-1">
          <Button onClick={start} disabled={busy || !text.trim()}>
            {busy ? "Starting..." : "Start research"}
          </Button>
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-6 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            onClick={() => setText(ex)}
            className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
