import { useState } from "react";
import type { Requirements, RunStatus } from "../../../src/shared.ts";
import { api } from "../api.ts";
import { Button, cx, formatPrice } from "./ui.tsx";

/**
 * Adjust the brief after seeing results. Weights and budget re-rank instantly
 * from the evidence already collected; must-have/dealbreaker changes re-check
 * each product. Nothing new is searched.
 */
export default function BriefEditor({
  runId,
  req,
  status,
  phaseDone,
  onDone,
  onCancel,
}: {
  runId: string;
  req: Requirements;
  status: RunStatus;
  phaseDone: boolean;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [weights, setWeights] = useState<Record<string, number>>(Object.fromEntries(req.criteria.map((c) => [c.name, c.weight])));
  const [budget, setBudget] = useState(req.budget.max);
  const [flex, setFlex] = useState(req.budget.flexPercent ?? 0);
  const [mustHaves, setMustHaves] = useState(req.mustHaves);
  const [dealbreakers, setDealbreakers] = useState(req.dealbreakers);
  const [niceToHaves, setNiceToHaves] = useState(req.niceToHaves);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = Object.values(weights).reduce((s, w) => s + w, 0);
  const balanced = Math.abs(total - 100) <= 1;
  const rulesChanged =
    JSON.stringify(mustHaves) !== JSON.stringify(req.mustHaves) || JSON.stringify(dealbreakers) !== JSON.stringify(req.dealbreakers);

  function balance() {
    if (total <= 0) return;
    const names = Object.keys(weights);
    const scaled = names.map((n) => Math.floor((weights[n] / total) * 100));
    let rest = 100 - scaled.reduce((s, w) => s + w, 0);
    // hand the rounding remainder to the largest weights
    const order = names.map((_, i) => i).sort((a, b) => weights[names[b]] - weights[names[a]]);
    for (const i of order) {
      if (rest <= 0) break;
      scaled[i]++;
      rest--;
    }
    setWeights(Object.fromEntries(names.map((n, i) => [n, scaled[i]])));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.editBrief(runId, { weights, budget: { max: budget, flexPercent: flex }, mustHaves, dealbreakers, niceToHaves });
      onDone(
        r.next === "none"
          ? r.changes.length
            ? "Saved. Resume the research to continue with the new brief."
            : "No changes."
          : r.next === "score"
            ? "Re-checking each product against your new must-haves, then updating the recommendation..."
            : "Re-ranked. Updating the recommendation...",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const running = status === "running" || status === "waiting";

  return (
    <div className="space-y-7 rounded-xl border border-zinc-300 bg-white p-6 shadow-sm">
      <div>
        <h3 className="font-semibold">Adjust the brief</h3>
        <p className="mt-1 text-sm text-zinc-600">
          Changes re-rank the products already researched, using the evidence already collected. Weights and budget update instantly;
          changing must-haves or dealbreakers re-checks each product (a minute or two). Nothing new is searched: for a different kind of
          product or a much bigger budget, start a new research.
        </p>
        {!phaseDone && <p className="mt-2 text-sm text-amber-700">This research isn't finished: your changes apply when you resume it.</p>}
      </div>

      {/* Budget */}
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Budget</div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            Up to
            <input
              type="number"
              min={0}
              step={500}
              value={budget}
              onChange={(e) => setBudget(Number(e.target.value))}
              className="w-32 rounded-md border border-zinc-300 px-2 py-1.5 tabular-nums outline-none focus:border-zinc-500"
            />
            {req.budget.currency}
          </label>
          <label className="flex items-center gap-2">
            can stretch
            <input
              type="number"
              min={0}
              max={100}
              value={flex}
              onChange={(e) => setFlex(Number(e.target.value))}
              className="w-20 rounded-md border border-zinc-300 px-2 py-1.5 tabular-nums outline-none focus:border-zinc-500"
            />
            %
          </label>
          {budget > 0 && <span className="text-zinc-500">limit {formatPrice(budget * (1 + flex / 100), req.budget.currency)}</span>}
        </div>
      </div>

      {/* Weights */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">What matters, and how much</div>
          <div className={cx("text-xs tabular-nums", balanced ? "text-zinc-500" : "text-amber-700")}>
            total {total}/100
            {!balanced && (
              <button onClick={balance} className="ml-2 rounded border border-amber-300 px-1.5 py-0.5 text-amber-800 hover:bg-amber-50">
                Balance to 100
              </button>
            )}
          </div>
        </div>
        <div className="space-y-3">
          {req.criteria.map((c) => (
            <div key={c.name}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{c.name}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={weights[c.name]}
                  onChange={(e) => setWeights({ ...weights, [c.name]: Math.max(0, Math.min(100, Number(e.target.value))) })}
                  className="w-16 rounded-md border border-zinc-300 px-2 py-0.5 text-right tabular-nums outline-none focus:border-zinc-500"
                />
              </div>
              <input
                type="range"
                min={0}
                max={60}
                value={weights[c.name]}
                onChange={(e) => setWeights({ ...weights, [c.name]: Number(e.target.value) })}
                className="mt-1 w-full accent-zinc-900"
              />
              <div className="text-xs text-zinc-500">{c.description}</div>
            </div>
          ))}
        </div>
      </div>

      <ListEditor title="Must-haves (product is ruled out without these)" items={mustHaves} onChange={setMustHaves} tone="green" />
      <ListEditor title="Dealbreakers (product is ruled out if these apply)" items={dealbreakers} onChange={setDealbreakers} tone="red" />
      <ListEditor title="Nice to have" items={niceToHaves} onChange={setNiceToHaves} tone="zinc" />

      {rulesChanged && <p className="text-sm text-zinc-600">Must-haves or dealbreakers changed: each product will be re-checked against its evidence.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={busy || !balanced || running}>
          {busy ? "Saving..." : phaseDone ? "Save and update ranking" : "Save"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {running && <span className="text-sm text-amber-700">Stop the research first.</span>}
      </div>
    </div>
  );
}

function ListEditor({ title, items, onChange, tone }: { title: string; items: string[]; onChange: (xs: string[]) => void; tone: "green" | "red" | "zinc" }) {
  const [draft, setDraft] = useState("");
  const tones = { green: "bg-emerald-50 text-emerald-900", red: "bg-red-50 text-red-900", zinc: "bg-zinc-100 text-zinc-800" };
  const add = () => {
    const v = draft.trim();
    if (v && !items.includes(v)) onChange([...items, v]);
    setDraft("");
  };
  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {items.map((x) => (
          <span key={x} className={cx("inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium", tones[tone])}>
            {x}
            <button onClick={() => onChange(items.filter((y) => y !== x))} className="ml-0.5 opacity-60 hover:opacity-100" aria-label={`Remove ${x}`}>
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          onBlur={add}
          placeholder="add..."
          className="w-40 rounded-md border border-dashed border-zinc-300 px-2 py-1 text-xs outline-none focus:border-zinc-500"
        />
      </div>
    </div>
  );
}
