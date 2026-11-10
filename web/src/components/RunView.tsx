import { useEffect, useState } from "react";
import { PHASE_ORDER, type Phase, type RunDetail } from "../../../src/shared.ts";
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
  const canResume = (status === "idle" || status === "error") && state.phase !== "done";
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
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{state.initialRequest}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canAdjust && !editing && (
            <Button variant="secondary" onClick={openEditor}>
              Adjust brief
            </Button>
          )}
          {isWorking && (
            <Button variant="secondary" onClick={stop} disabled={busy} className="hover:border-red-300 hover:text-red-700">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-current" />
              {busy ? "Stopping..." : "Stop"}
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

      {/* Phase stepper */}
      <ol className="mt-6 flex flex-wrap items-center gap-1 text-xs">
        {STEPS.map((s, i) => {
          const idx = PHASE_ORDER.indexOf(s.phase);
          const done = idx < currentIndex;
          const current = idx === currentIndex;
          return (
            <li key={s.phase} className="flex items-center gap-1">
              <span
                className={cx(
                  "rounded-full px-2.5 py-1 font-medium",
                  done && "bg-zinc-900 text-white",
                  current && (status === "running" || status === "waiting") && "bg-amber-100 text-amber-900 ring-1 ring-amber-300",
                  current && !(status === "running" || status === "waiting") && "bg-zinc-200 text-zinc-800",
                  !done && !current && "bg-zinc-100 text-zinc-400",
                )}
              >
                {s.label}
              </span>
              {i < STEPS.length - 1 && <span className="text-zinc-300">›</span>}
            </li>
          );
        })}
      </ol>

      {status === "error" && detail.error && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="font-medium">Stopped:</span> {detail.error}. Progress is saved. Fix the cause (e.g. an API key) and press Resume.
        </div>
      )}
      {status === "idle" && state.phase !== "done" && (
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
                    {formatPrice(c.bestPrice.amount, c.bestPrice.currency)} at {c.bestPrice.seller}
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
              {formatPrice(top[0].bestPrice.amount, top[0].bestPrice.currency)} at {top[0].bestPrice.seller}
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
            <Candidates state={state} />
          </>
        )}
        {activeTab === "evidence" && <EvidenceList evidence={state.evidence} candidates={state.candidates} />}
        {activeTab === "activity" && <Activity events={detail.events} />}
      </div>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.addCandidate(runId, name, note);
      setName("");
      setNote("");
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
          placeholder="Why (optional)"
          className="w-56 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
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
