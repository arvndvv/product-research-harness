import { useEffect, useState } from "react";
import { PHASE_ORDER, type Phase, type RunDetail, type RunState } from "../../../src/shared.ts";
import { api, useRun } from "../api.ts";
import { Activity, Brief, Candidates, EvidenceList, Interview, ranked, Report } from "./panels.tsx";
import BriefEditor from "./BriefEditor.tsx";
import QuestionCard from "./QuestionCard.tsx";
import WorkingPanel from "./WorkingPanel.tsx";
import { Button, Chip, cx, formatPrice, StatusBadge } from "./ui.tsx";

type Tab = "report" | "interview" | "brief" | "candidates" | "evidence" | "activity";

const STEPS: { phase: Phase; label: string }[] = [
  { phase: "intake", label: "Interview" },
  { phase: "discover", label: "Discover" },
  { phase: "shortlist", label: "Shortlist" },
  { phase: "research", label: "Research" },
  { phase: "score", label: "Score" },
  { phase: "critique", label: "Review" },
  { phase: "report", label: "Report" },
];

function defaultTab(d: RunDetail): Tab {
  if (d.state.phase === "done") return "report";
  if (d.state.phase === "intake") return "interview";
  if (d.state.candidates.length) return "candidates";
  return "activity";
}

export default function RunView({ id, onChange }: { id: string; onChange: () => void }) {
  const { detail, error, refresh } = useRun(id);
  const [tab, setTab] = useState<Tab | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmStep, setConfirmStep] = useState<"discover" | "shortlist" | null>(null);

  // Follow the run: switch tab automatically until the user picks one.
  const [userPicked, setUserPicked] = useState(false);
  useEffect(() => {
    if (detail && !userPicked) setTab(defaultTab(detail));
  }, [detail?.state.phase, detail?.state.candidates.length, userPicked]);

  useEffect(() => {
    onChange();
  }, [detail?.status, detail?.state.phase]);

  // "Researching X now..." / "Updating the recommendation..." notices end when the work does.
  useEffect(() => {
    if (detail?.status === "done") setNotice(null);
  }, [detail?.status]);

  if (error) return <div className="p-10 text-red-600">{error}</div>;
  if (!detail) return <div className="p-10 text-zinc-400">Loading...</div>;

  const { state, status, pending } = detail;
  const req = state.requirements;
  const currentIndex = PHASE_ORDER.indexOf(state.phase);
  const top = ranked(state.candidates).filter((c) => !c.disqualified && !c.incomplete);
  const tied = top.filter((c) => (top[0]?.total ?? 0) - (c.total ?? 0) < detail.tieMargin).slice(0, 3);
  // At the budget, Resume would pause again at once: the budget banner offers "Raise and resume" instead.
  const canResume = (status === "idle" || status === "error") && state.phase !== "done" && !overBudget(state);
  const isWorking = status === "running" || status === "waiting";
  const canAdjust = !!req && !isWorking;

  async function stop() {
    setBusy(true);
    try {
      await api.stop(id);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  function openEditor() {
    setEditing(true);
    setTab("brief");
    setUserPicked(true);
    setNotice(null);
  }

  async function restart(step: "discover" | "shortlist") {
    setConfirmStep(null);
    setBusy(true);
    try {
      const r = await api.restart(id, step);
      setNotice(r.message);
      setUserPicked(false);
      refresh();
    } catch (e) {
      setNotice(`Couldn't go back: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    setBusy(true);
    try {
      await api.resume(id);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  const tabs: { id: Tab; label: string; count?: number; show: boolean }[] = [
    { id: "report", label: "Recommendation", show: !!detail.report },
    { id: "interview", label: "Interview", show: true },
    { id: "brief", label: "Brief", show: !!req },
    { id: "candidates", label: "Products", count: state.candidates.length, show: true },
    { id: "evidence", label: "Evidence", count: state.evidence.length, show: true },
    { id: "activity", label: "Activity", show: true },
  ];
  const activeTab = tab ?? defaultTab(detail);

  return (
    <div className="mx-auto max-w-5xl px-8 pb-20 pt-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={status} />
            {req && <Chip>{req.category}</Chip>}
            {req && req.budget.max > 0 && (
              <Chip>
                up to {req.budget.max.toLocaleString()} {req.budget.currency}
              </Chip>
            )}
            {state.round > 0 && <Chip tone="sky">research round {state.round + 1}</Chip>}
            <CostMeter state={state} runId={id} onChanged={refresh} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{state.initialRequest}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {req && !isWorking && currentIndex > PHASE_ORDER.indexOf("discover") && <GoBackMenu currentIndex={currentIndex} busy={busy} onPick={setConfirmStep} />}
          {canAdjust && !editing && (
            <Button variant="secondary" onClick={openEditor}>
              Adjust brief
            </Button>
          )}
          {isWorking && (
            <Button variant="secondary" onClick={stop} disabled={busy} className="hover:border-red-300 hover:text-red-700">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-current" />
              {busy ? "Pausing..." : "Pause"}
            </Button>
          )}
          {canResume && (
            <Button onClick={() => { setNotice(null); resume(); }} disabled={busy}>
              {busy ? "Resuming..." : "Resume"}
            </Button>
          )}
        </div>
      </div>

      {notice && (
        <div className="mt-6 flex items-start justify-between gap-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-sky-700 hover:text-sky-900" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {confirmStep && <ConfirmGoBack step={confirmStep} detail={detail} onCancel={() => setConfirmStep(null)} onConfirm={() => restart(confirmStep)} />}

      {/* Phase stepper */}
      <ol className="mt-6 flex flex-wrap items-center gap-1 text-xs">
        {STEPS.map((s, i) => {
          const idx = PHASE_ORDER.indexOf(s.phase);
          const done = idx < currentIndex;
          const current = idx === currentIndex;
          // Discover and Shortlist can be re-run from any later step.
          // Only while paused or finished: going back while it's working would be confusing.
          const canGoBack = !!req && !isWorking && done && (s.phase === "discover" || s.phase === "shortlist") && !busy;
          const cls = cx(
            "rounded-full px-2.5 py-1 font-medium",
            done && "bg-zinc-900 text-white",
            current && (status === "running" || status === "waiting") && "bg-amber-100 text-amber-900 ring-1 ring-amber-300",
            current && !(status === "running" || status === "waiting") && "bg-zinc-200 text-zinc-800",
            !done && !current && "bg-zinc-100 text-zinc-400",
          );
          return (
            <li key={s.phase} className="flex items-center gap-1">
              {canGoBack ? (
                <button
                  onClick={() => setConfirmStep(s.phase as "discover" | "shortlist")}
                  title={`Go back to ${s.label} and continue from there`}
                  className={cx(cls, "inline-flex items-center gap-1 transition hover:bg-zinc-700")}
                >
                  {s.label}
                  <span aria-hidden className="text-zinc-400">↺</span>
                </button>
              ) : (
                <span className={cls}>{s.label}</span>
              )}
              {i < STEPS.length - 1 && <span className="text-zinc-300">›</span>}
            </li>
          );
        })}
        {req && !isWorking && currentIndex > PHASE_ORDER.indexOf("discover") && (
          <li className="ml-2 text-zinc-400">↺ click to go back to that step</li>
        )}
        {req && isWorking && currentIndex > PHASE_ORDER.indexOf("discover") && (
          <li className="ml-2 text-zinc-400">Pause to go back to an earlier step</li>
        )}
      </ol>

      {status === "error" && detail.error && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="font-medium">Stopped:</span> {detail.error}. Progress is saved. Fix the cause (e.g. an API key) and press Resume.
        </div>
      )}
      {status === "idle" && overBudget(state) && <BudgetPaused state={state} runId={id} onDone={(msg) => { setNotice(msg); refresh(); }} />}
      {status === "idle" && state.phase !== "done" && !overBudget(state) && (
        <div className="mt-6 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
          Paused. Everything found so far is kept; press Resume to continue from the {state.phase} step. You can also adjust the brief first.
          {state.phase === "intake" && " The interview starts again from the beginning."}
        </div>
      )}

      {/* Effectively tied leaders */}
      {state.phase === "done" && tied.length >= 2 && (
        <div className="mt-6 rounded-2xl bg-zinc-900 p-6 text-white">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">Top picks for you · effectively tied</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tied.map((c) => (
              <div key={c.name} className="rounded-xl bg-white/5 p-4">
                <div className="font-semibold">{c.name}</div>
                <div className="mt-1 text-sm tabular-nums text-zinc-300">{c.total}/100</div>
                {c.bestPrice && (
                  <div className="mt-1 text-sm text-zinc-300">
                    {formatPrice(c.bestPrice.amount, c.bestPrice.currency)} at{" "}
                    <a href={c.bestPrice.url} target="_blank" rel="noreferrer" className="underline decoration-zinc-500 underline-offset-2 hover:text-white">
                      {c.bestPrice.seller} ↗
                    </a>
                    {!c.bestPrice.verified && <span className="text-amber-300"> · check price</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 text-sm text-zinc-400">
            Their scores are within {detail.tieMargin} points, inside the margin of error. The recommendation explains which one suits you better depending on what matters most.
          </div>
        </div>
      )}

      {/* Winner banner */}
      {state.phase === "done" && top[0] && tied.length < 2 && (
        <div className="mt-6 rounded-2xl bg-zinc-900 p-6 text-white">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">Recommended for you</div>
          <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
            <div className="text-2xl font-semibold">{top[0].name}</div>
            <div className="text-lg tabular-nums text-zinc-300">{top[0].total}/100</div>
          </div>
          {top[0].bestPrice && (
            <div className="mt-1 text-sm text-zinc-300">
              {formatPrice(top[0].bestPrice.amount, top[0].bestPrice.currency)} at{" "}
              <a href={top[0].bestPrice.url} target="_blank" rel="noreferrer" className="underline decoration-zinc-500 underline-offset-2 hover:text-white">
                {top[0].bestPrice.seller} ↗
              </a>
              {!top[0].bestPrice.verified && <span className="text-amber-300"> · price not confirmed on a seller page, check before buying</span>}
            </div>
          )}
          {top[1] && (
            <div className="mt-2 text-sm text-zinc-400">
              Runner-up: {top[1].name} ({top[1].total}/100)
            </div>
          )}
        </div>
      )}

      {/* Live progress while working */}
      {status === "running" && !pending && (
        <div className="mt-6">
          <WorkingPanel detail={detail} />
        </div>
      )}

      {/* Pending question */}
      {pending && (
        <div className="mt-6">
          <QuestionCard
            key={pending.id}
            question={pending}
            onAnswer={async (text) => {
              await api.answer(id, pending.id, text);
              refresh();
            }}
          />
        </div>
      )}

      {/* Tabs */}
      <div className="mt-8 flex gap-1 border-b border-zinc-200">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                setUserPicked(true);
              }}
              className={cx(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition",
                activeTab === t.id ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800",
              )}
            >
              {t.label}
              {t.count ? <span className="ml-1.5 text-xs text-zinc-400">{t.count}</span> : null}
            </button>
          ))}
      </div>

      <div className="mt-6">
        {activeTab === "report" && <Report markdown={detail.report} />}
        {activeTab === "interview" && <Interview events={detail.events} />}
        {activeTab === "brief" &&
          (editing && req ? (
            <BriefEditor
              runId={id}
              req={req}
              status={status}
              phaseDone={state.phase === "done"}
              onCancel={() => setEditing(false)}
              onDone={(message) => {
                setEditing(false);
                setNotice(message);
                setUserPicked(false);
                refresh();
              }}
            />
          ) : (
            <>
              {canAdjust && <AdjustCallout onClick={openEditor} />}
              <Brief req={req} profileUpdates={state.profileUpdates} />
              {state.briefEdits?.length ? (
                <div className="mt-4 text-xs text-zinc-500">
                  {state.briefEdits.map((e, i) => (
                    <div key={i}>
                      Adjusted {new Date(e.t).toLocaleString()}: {e.changes.join("; ")}
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ))}
        {activeTab === "candidates" && (
          <>
            {canAdjust && state.candidates.some((c) => c.total !== undefined) && <AdjustCallout onClick={openEditor} />}
            {canAdjust && state.requirements && (
              <AddProduct
                runId={id}
                finished={state.phase === "done"}
                onAdded={(msg) => {
                  setNotice(msg);
                  refresh();
                }}
              />
            )}
            <Candidates
              state={state}
              runId={id}
              canEdit={canAdjust}
              onNotice={(msg) => {
                setNotice(msg);
                refresh();
              }}
            />
          </>
        )}
        {activeTab === "evidence" && <EvidenceList evidence={state.evidence} candidates={state.candidates} />}
        {activeTab === "activity" && <Activity events={detail.events} />}
      </div>
    </div>
  );
}

const usd = (n: number) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
const overBudget = (s: RunState) => !!s.budgetUsd && (s.cost?.usd ?? 0) >= s.budgetUsd;

/** Live cost of the run against its budget. Click to see the breakdown or change the budget. */
function CostMeter({ state, runId, onChanged }: { state: RunState; runId: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cost = state.cost;
  const spent = cost?.usd ?? 0;
  const budget = state.budgetUsd ?? 0;
  const ratio = budget ? spent / budget : 0;
  const tone = budget && ratio >= 1 ? "red" : budget && ratio >= 0.8 ? "amber" : "zinc";

  async function save() {
    setError(null);
    try {
      await api.setBudget(runId, Number(value));
      setOpen(false);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => {
          setValue(String(budget || ""));
          setOpen((o) => !o);
        }}
        className={cx(
          "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums transition",
          tone === "red" ? "bg-red-100 text-red-800" : tone === "amber" ? "bg-amber-100 text-amber-900" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200",
        )}
        title="What this run has cost so far. Click for details or to change the budget."
      >
        {usd(spent)}
        <span className="font-normal opacity-70">{budget ? `of ${usd(budget)}` : "no limit"}</span>
        {cost?.unpriced?.length ? <span className="text-amber-700">*</span> : null}
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-80 rounded-xl border border-zinc-200 bg-white p-3 text-sm shadow-lg">
          <div className="font-medium">Cost of this run</div>
          {cost ? (
            <>
              <table className="mt-1 w-full text-xs">
                <tbody>
                  {Object.entries(cost.byPhase).map(([phase, v]) => (
                    <tr key={phase}>
                      <td className="py-0.5 text-zinc-600">{phase}</td>
                      <td className="py-0.5 text-right tabular-nums">{usd(v ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-zinc-500">
                {cost.calls} model calls · {(cost.inputTokens / 1e6).toFixed(2)}M tokens in ({Math.round((cost.cachedTokens / Math.max(1, cost.inputTokens)) * 100)}% cached) · {(cost.outputTokens / 1e3).toFixed(0)}K out
              </p>
              {cost.unpriced?.length ? (
                <p className="mt-1 text-xs text-amber-700">* No price set for {cost.unpriced.join(", ")}: counted as $0. Add it in Profile &gt; Models &amp; search.</p>
              ) : null}
            </>
          ) : (
            <p className="mt-1 text-xs text-zinc-500">No model calls recorded yet. Runs started before cost tracking existed only count calls made from now on.</p>
          )}
          <div className="mt-3 border-t border-zinc-100 pt-3">
            <label className="text-xs font-medium text-zinc-700">Budget for this run (USD, 0 = no limit)</label>
            <div className="mt-1 flex gap-2">
              <input type="number" min="0" step="0.1" value={value} onChange={(e) => setValue(e.target.value)} className="w-28 rounded-lg border border-zinc-300 px-2 py-1 font-mono text-sm outline-none focus:border-zinc-500" />
              <Button variant="secondary" onClick={save}>
                Save
              </Button>
            </div>
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Shown when the run paused at its budget: raise it and continue in one step. */
function BudgetPaused({ state, runId, onDone }: { state: RunState; runId: string; onDone: (msg: string) => void }) {
  const spent = state.cost?.usd ?? 0;
  const [value, setValue] = useState(String(Math.ceil((spent + Math.max(0.5, (state.budgetUsd ?? 1) * 0.5)) * 10) / 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      const n = Number(value);
      if (n && n <= spent) throw new Error(`set it above what's spent (${usd(spent)}), or 0 for no limit`);
      await api.setBudget(runId, n);
      await api.resume(runId);
      onDone(`Budget raised to ${n ? usd(n) : "no limit"}; continuing from the ${state.phase} step.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <div>
        <span className="font-medium">Paused at the budget:</span> this run has cost {usd(spent)} of its {usd(state.budgetUsd ?? 0)} budget. Everything is saved.
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span>Raise the budget to $</span>
        <input type="number" min="0" step="0.1" value={value} onChange={(e) => setValue(e.target.value)} className="w-24 rounded-lg border border-amber-300 bg-white px-2 py-1 font-mono text-sm outline-none" />
        <Button onClick={go} disabled={busy}>
          {busy ? "Resuming..." : "Raise and resume"}
        </Button>
        <span className="text-xs text-amber-800">or go back to an earlier step, or leave it here.</span>
      </div>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

/** Spells out what going back keeps and what it throws away, with this run's actual numbers. */
function ConfirmGoBack({ step, detail, onCancel, onConfirm }: { step: "discover" | "shortlist"; detail: RunDetail; onCancel: () => void; onConfirm: () => void }) {
  const { state } = detail;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const found = state.candidates.filter((c) => c.cutReason !== "Removed by you");
  const yours = found.filter((c) => c.addedByUser);
  const shortlisted = state.candidates.filter((c) => c.status === "shortlist").length;
  const scored = state.candidates.filter((c) => c.total !== undefined).length;
  const findings = state.evidence.length;
  const prices = state.prices?.length ?? 0;
  const yourFindings = state.evidence.filter((e) => yours.some((c) => c.name === e.candidate)).length;

  const lost: string[] =
    step === "shortlist"
      ? [
          shortlisted ? `The shortlist (${plural(shortlisted, "product")}) and the reasons others were cut` : "",
          scored ? `Scores and rankings for ${plural(scored, "product")}` : "",
          state.round > 0 ? `Progress from ${plural(state.round + 1, "research round")} and the reviewer's notes` : "",
          detail.report ? "The current recommendation (kept as a backup file, no longer shown)" : "",
        ]
      : [
          `${plural(found.length - yours.length, "product")} found by the search${yours.length ? ` (the ${yours.length} you added stay)` : ""}`,
          findings - yourFindings ? `${plural(findings - yourFindings, "finding")} and the prices recorded for those products` : "",
          shortlisted ? `The shortlist (${plural(shortlisted, "product")})` : "",
          scored ? `Scores and rankings for ${plural(scored, "product")}` : "",
          detail.report ? "The current recommendation (kept as a backup file, no longer shown)" : "",
        ];
  const kept: string[] =
    step === "shortlist"
      ? [
          "Your interview answers and the brief",
          `All ${plural(found.length, "product")} found, for you to review, add to or remove from`,
          findings || prices ? `${plural(findings, "verified finding")} and ${plural(prices, "price")}, reused when products are researched again` : "",
        ]
      : [
          "Your interview answers and the brief",
          yours.length ? `The ${plural(yours.length, "product")} you added, with their findings` : "",
          "Products researched before stay in the category library; their findings come back if they're found again",
        ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-900/40 p-4" onClick={onCancel}>
      <div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">Go back to {step === "shortlist" ? "Shortlist" : "Discover"}?</h2>
        <p className="mt-1 text-sm text-zinc-600">
          {step === "shortlist"
            ? "You'll review the product list again, then the shortlist is picked and researched again from there."
            : "Products are searched for again from scratch, then you review the new list."}
        </p>
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3">
          <div className="text-sm font-medium text-red-900">This progress will be lost</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-red-900">
            {lost.filter(Boolean).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
        <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
          <div className="text-sm font-medium text-zinc-800">Kept</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-zinc-700">
            {kept.filter(Boolean).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
        <p className="mt-3 text-xs text-zinc-500">The steps after it run again, which uses model calls and searches like a new run from that point.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <button onClick={onConfirm} className="rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-red-700">
            Go back to {step === "shortlist" ? "Shortlist" : "Discover"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Go back to a step" menu in the header: re-run Discover or Shortlist without a new search. */
function GoBackMenu({ currentIndex, busy, onPick }: { currentIndex: number; busy: boolean; onPick: (step: "discover" | "shortlist") => void }) {
  const [open, setOpen] = useState(false);
  const options = [
    { step: "shortlist" as const, label: "Shortlist", hint: "Review the products found, add or remove, pick again. Keeps findings." },
    { step: "discover" as const, label: "Discover", hint: "Search for products again from scratch. Keeps the brief." },
  ].filter((o) => PHASE_ORDER.indexOf(o.step) < currentIndex);
  return (
    <div className="relative">
      <Button variant="secondary" onClick={() => setOpen((o) => !o)} disabled={busy}>
        ↺ Go back to…
      </Button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-80 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg">
          {options.map((o) => (
            <button
              key={o.step}
              onClick={() => {
                setOpen(false);
                onPick(o.step);
              }}
              className="block w-full rounded-lg px-3 py-2 text-left hover:bg-zinc-100"
            >
              <div className="text-sm font-medium text-zinc-900">{o.label}</div>
              <div className="text-xs text-zinc-500">{o.hint}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A visible prompt to tweak the brief, shown above the brief and the product table. */
function AdjustCallout({ onClick }: { onClick: () => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3">
      <div className="text-sm">
        <span className="font-medium text-zinc-900">Not quite right?</span>{" "}
        <span className="text-zinc-600">Change what matters most, your budget, or must-haves, and the ranking updates from the research already done.</span>
      </div>
      <Button variant="secondary" onClick={onClick}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
          <circle cx="16" cy="6" r="2" />
          <circle cx="10" cy="12" r="2" />
          <circle cx="18" cy="18" r="2" />
        </svg>
        Adjust priorities
      </Button>
    </div>
  );
}

/** Suggest a product the research missed. It's researched and scored like the others. */
function AddProduct({ runId, finished, onAdded }: { runId: string; finished: boolean; onAdded: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.addCandidate(runId, name, note, link.split(/\s+/).filter(Boolean));
      setName("");
      setNote("");
      setLink("");
      setOpen(false);
      onAdded(
        r.started
          ? `Researching ${r.name} now. It's scored with the same evidence bar and budget check as the others, then the recommendation is updated.`
          : `${r.name} added. It's researched when you resume.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <div className="mb-4 flex justify-end">
        <Button variant="ghost" onClick={() => setOpen(true)}>
          + Suggest a product to compare
        </Button>
      </div>
    );
  return (
    <div className="mb-4 rounded-xl border border-zinc-300 bg-white p-4">
      <div className="text-sm font-medium">Suggest a product to compare</div>
      <p className="mt-0.5 text-xs text-zinc-500">
        It gets the same research, measurements, budget check and side-by-side comparison as the others
        {finished ? ", then the recommendation is rewritten. Nothing else is researched again." : "."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full product name, e.g. Samsung Galaxy S24 FE"
          className="min-w-64 flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && submit()}
          placeholder="Why (optional), e.g. refurbished is fine"
          className="w-56 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
        />
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && submit()}
          placeholder="Link to check (optional): the product page with the price you saw"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-xs outline-none focus:border-zinc-500"
        />
        <Button onClick={submit} disabled={busy || name.trim().length < 2}>
          {busy ? "Adding..." : finished ? "Research and compare" : "Add"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
