import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Candidate, Evidence, Requirements, RunEvent, RunState } from "../../../src/shared.ts";
import { Chip, cx, Empty, formatPrice, hostOf } from "./ui.tsx";

/** Same ranking as src/scoring.ts: eligible first, then incomplete, then disqualified; by total within each. */
const tier = (c: Candidate) => (!c.disqualified && !c.incomplete ? 0 : c.incomplete && !c.disqualified ? 1 : 2);
export function ranked(candidates: Candidate[]) {
  return candidates
    .filter((c) => c.status === "shortlist" && c.total !== undefined)
    .sort((a, b) => tier(a) - tier(b) || (b.total ?? 0) - (a.total ?? 0));
}

// --- Interview transcript ---------------------------------------------------------

export function Interview({ events }: { events: RunEvent[] }) {
  const turns = events.filter((e) => e.type === "question" || e.type === "answer");
  if (!turns.length) return <Empty>The interview hasn't started yet.</Empty>;
  return (
    <div className="space-y-3">
      {turns.map((e, i) =>
        e.type === "question" ? (
          <div key={i} className="max-w-[85%]">
            <div className="rounded-2xl rounded-tl-sm bg-white px-4 py-2.5 text-sm text-zinc-800 shadow-sm ring-1 ring-zinc-200">
              {e.question.question}
            </div>
          </div>
        ) : e.type === "answer" ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-zinc-900 px-4 py-2.5 text-sm text-white">{e.text}</div>
          </div>
        ) : null,
      )}
    </div>
  );
}

// --- Brief (requirements) -------------------------------------------------------

export function Brief({ req, profileUpdates }: { req?: Requirements; profileUpdates?: string[] }) {
  if (!req) return <Empty>The brief is written at the end of the interview.</Empty>;
  const list = (title: string, items: string[], tone: "green" | "red" | "zinc" | "amber") =>
    items.length ? (
      <div>
        <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</div>
        <div className="flex flex-wrap gap-1.5">
          {items.map((x) => (
            <Chip key={x} tone={tone}>
              {x}
            </Chip>
          ))}
        </div>
      </div>
    ) : null;

  return (
    <div className="space-y-6 rounded-xl border border-zinc-200 bg-white p-6">
      <div>
        <p className="text-zinc-800">{req.summary}</p>
        <p className="mt-2 text-sm text-zinc-500">{req.useCase}</p>
      </div>
      <div className="flex flex-wrap gap-6 text-sm">
        <div>
          <div className="text-xs text-zinc-500">Budget</div>
          <div className="font-medium">
            {req.budget.max > 0 ? formatPrice(req.budget.max, req.budget.currency) : "No fixed budget"}
            {req.budget.max > 0 && <span className="font-normal text-zinc-500">{req.budget.flexPercent ? ` (can stretch ${req.budget.flexPercent}%)` : " (strict)"}</span>}
          </div>
        </div>
        <div>
          <div className="text-xs text-zinc-500">Buying in</div>
          <div className="font-medium">{req.region}</div>
        </div>
      </div>
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">What matters, and how much</div>
        <div className="space-y-2.5">
          {req.criteria.map((c) => (
            <div key={c.name}>
              <div className="flex justify-between text-sm">
                <span className="font-medium">{c.name}</span>
                <span className="text-zinc-500">{c.weight}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                <div className="h-full rounded-full bg-zinc-800" style={{ width: `${c.weight}%` }} />
              </div>
              <div className="mt-1 text-xs text-zinc-500">{c.description}</div>
            </div>
          ))}
        </div>
      </div>
      {list("Must-haves", req.mustHaves, "green")}
      {list("Dealbreakers", req.dealbreakers, "red")}
      {list("Nice to have", req.niceToHaves, "zinc")}
      {list("Assumed (not asked)", req.assumptions ?? [], "amber")}
      {profileUpdates && profileUpdates.length > 0 && (
        <div className="rounded-lg bg-sky-50 px-4 py-3 text-sm text-sky-900">
          Saved to your profile from this interview: {profileUpdates.join("; ")}
        </div>
      )}
    </div>
  );
}

// --- Candidates / scoreboard ----------------------------------------------------

const scoreColor = (s: number) => (s >= 8 ? "bg-emerald-100 text-emerald-900" : s >= 6 ? "bg-lime-50 text-lime-900" : s >= 4 ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-900");

export function Candidates({ state }: { state: RunState }) {
  const [open, setOpen] = useState<string | null>(null);
  const req = state.requirements;
  const scored = ranked(state.candidates);
  const pending = state.candidates.filter((c) => c.status === "shortlist" && c.total === undefined);
  const longlist = state.candidates.filter((c) => c.status === "longlist");
  const cut = state.candidates.filter((c) => c.status === "cut");

  if (!state.candidates.length) return <Empty>No products found yet. They'll show up here as discovery runs.</Empty>;

  return (
    <div className="space-y-8">
      {req && scored.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-3 py-3 text-right font-medium">Score</th>
                <th className="px-3 py-3 text-right font-medium">Price</th>
                {req.criteria.map((c) => (
                  <th key={c.name} className="px-3 py-3 text-center font-medium">
                    {c.name}
                    <div className="font-normal text-zinc-400">{c.weight}%</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scored.map((c, i) => (
                <ScoreRow key={c.name} c={c} rank={i + 1} req={req} open={open === c.name} onToggle={() => setOpen(open === c.name ? null : c.name)} />
              ))}
            </tbody>
          </table>
          <p className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">
            Scores are 0-10 per criterion: measurements (lab scores, benchmarks, test hours) on a fixed scale where available, combined with a
            side-by-side comparison of the evidence. ~ medium confidence, ? low confidence. Price is the lowest current price found on a seller's
            page; <span className="text-amber-600">?</span> means it was only seen in articles. Click a row for the measurements and reasons.
          </p>
        </div>
      )}

      {pending.length > 0 && <CandidateList title="Being researched" items={pending} />}
      {longlist.length > 0 && <CandidateList title="Longlist" items={longlist} />}
      {cut.length > 0 && <CandidateList title="Cut" items={cut} muted />}
    </div>
  );
}

function ScoreRow({ c, rank, req, open, onToggle }: { c: Candidate; rank: number; req: Requirements; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle} className={cx("cursor-pointer border-b border-zinc-100 hover:bg-zinc-50", (c.disqualified || c.incomplete) && "opacity-60")}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={cx("grid h-5 w-5 place-items-center rounded-full text-xs font-semibold", rank === 1 && !c.disqualified && !c.incomplete ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600")}>
              {rank}
            </span>
            <span className="font-medium">{c.name}</span>
            {c.addedByUser && <Chip tone="sky">added by you</Chip>}
          </div>
          {c.disqualified && <div className="mt-1 pl-7 text-xs text-red-700">Out: {c.disqualified}</div>}
          {!c.disqualified && c.incomplete && <div className="mt-1 pl-7 text-xs text-amber-700">Not enough evidence: {c.incomplete}</div>}
        </td>
        <td className="px-3 py-3 text-right text-base font-semibold tabular-nums">{c.total}</td>
        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
          {c.bestPrice ? (
            <span title={`${c.bestPrice.seller}${c.bestPrice.verified ? "" : " (only seen in articles)"}`}>
              {formatPrice(c.bestPrice.amount, c.bestPrice.currency)}
              {!c.bestPrice.verified && <span className="ml-1 text-amber-600">?</span>}
            </span>
          ) : (
            <span className="text-zinc-400">–</span>
          )}
        </td>
        {req.criteria.map((cr) => {
          const s = c.scores?.find((x) => x.criterion === cr.name);
          return (
            <td key={cr.name} className="px-3 py-3 text-center">
              {s ? (
                <span className={cx("inline-block min-w-9 rounded-md px-1.5 py-0.5 tabular-nums", scoreColor(s.score))}>
                  {s.score}
                  {s.confidence === "medium" ? "~" : s.confidence === "low" ? "?" : ""}
                </span>
              ) : (
                "–"
              )}
            </td>
          );
        })}
      </tr>
      {open && (
        <tr className="border-b border-zinc-100 bg-zinc-50">
          <td colSpan={req.criteria.length + 3} className="px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {c.scores?.map((s) => (
                <div key={s.criterion} className="text-sm">
                  <div>
                    <span className="font-medium">{s.criterion}: {s.score}</span>
                    <span className="ml-2 text-xs text-zinc-500">
                      {s.metricScore !== undefined
                        ? `measured ${s.metricScore} · compared ${s.judgedScore ?? "-"}`
                        : s.judgedScore !== undefined
                          ? `compared ${s.judgedScore} · no measurement found`
                          : ""}
                      {` · ${s.confidence} confidence`}
                    </span>
                  </div>
                  {s.measured && s.measured.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {s.measured.map((m) => (
                        <span
                          key={m.key}
                          className={cx("rounded px-1.5 py-0.5 text-xs", m.confirmed === false ? "bg-amber-50 text-amber-900" : "bg-sky-50 text-sky-900")}
                          title={m.confirmed === false ? "Single source: not confirmed by the authoritative site or a second source" : "Confirmed: authoritative source, or two sources agree"}
                        >
                          {m.label}: {m.value} {m.unit} → {m.score}/10{m.confirmed === false ? " (1 source)" : " ✓"}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-0.5 text-zinc-700">
                    {s.rationale}
                    {s.evidenceIds.length > 0 && <span className="text-xs text-zinc-400"> ({s.evidenceIds.slice(0, 6).join(", ")})</span>}
                  </div>
                </div>
              ))}
            </div>
            {c.notes.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-zinc-500">
                {c.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function CandidateList({ title, items, muted }: { title: string; items: Candidate[]; muted?: boolean }) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
        {title} ({items.length})
      </div>
      <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
        {items.map((c) => (
          <li key={c.name} className={cx("px-4 py-3 text-sm", muted && "text-zinc-500")}>
            <div className="flex items-baseline justify-between gap-3">
              <span className={cx("font-medium", !muted && "text-zinc-900")}>
                {c.name}
                {c.addedByUser && <span className="ml-2 align-middle"><Chip tone="sky">added by you</Chip></span>}
              </span>
              {c.price && <span className="shrink-0 text-xs text-zinc-500">{c.price}</span>}
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">{c.cutReason ?? c.whyConsidered}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Evidence ---------------------------------------------------------------------

const SENTIMENT_TONE = { positive: "green", negative: "red", mixed: "amber", neutral: "zinc" } as const;
const SOURCE_LABEL = { expert_review: "expert review", community: "owners / Reddit", spec: "specs", retailer: "retailer", other: "other" };

export function EvidenceList({ evidence, candidates }: { evidence: Evidence[]; candidates: Candidate[] }) {
  const names = useMemo(() => [...new Set(evidence.map((e) => e.candidate))], [evidence]);
  const [filter, setFilter] = useState<string>("all");
  const shown = filter === "all" ? evidence : evidence.filter((e) => e.candidate === filter);

  if (!evidence.length) return <Empty>No evidence recorded yet.</Empty>;
  const cut = new Set(candidates.filter((c) => c.status === "cut").map((c) => c.name));

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {["all", ...names].map((n) => (
          <button
            key={n}
            onClick={() => setFilter(n)}
            className={cx(
              "rounded-full border px-3 py-1 text-xs transition",
              filter === n ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300",
              cut.has(n) && filter !== n && "line-through",
            )}
          >
            {n === "all" ? `All (${evidence.length})` : `${n} (${evidence.filter((e) => e.candidate === n).length})`}
          </button>
        ))}
      </div>
      <ul className="space-y-2">
        {shown.map((e) => (
          <li key={e.id} className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-zinc-400">{e.id}</span>
              <Chip>{e.criterion}</Chip>
              <Chip tone={SENTIMENT_TONE[e.sentiment]}>{e.sentiment}</Chip>
              <Chip tone="sky">{SOURCE_LABEL[e.sourceType]}</Chip>
              {e.cachedFrom && <Chip>from research on {e.cachedFrom}</Chip>}
              {e.quote && <Chip tone="green">quote verified</Chip>}
              {filter === "all" && <span className="text-xs text-zinc-500">· {e.candidate}</span>}
            </div>
            <p className="mt-2 text-sm text-zinc-800">{e.finding}</p>
            {e.quote && <blockquote className="mt-1 border-l-2 border-zinc-200 pl-2 text-xs italic text-zinc-500">"{e.quote}"</blockquote>}
            <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline">
              {hostOf(e.sourceUrl)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Activity log -------------------------------------------------------------------

export function Activity({ events }: { events: RunEvent[] }) {
  const bottom = useRef<HTMLDivElement>(null);
  const lines = events.filter((e) => e.type === "log" || e.type === "phase");
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [lines.length]);

  if (!lines.length) return <Empty>Nothing has happened yet.</Empty>;
  return (
    <div className="scroll-thin max-h-[65vh] overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 font-mono text-xs leading-relaxed">
      {lines.map((e, i) =>
        e.type === "phase" ? (
          <div key={i} className="mb-1 mt-3 font-sans text-xs font-semibold uppercase tracking-wide text-zinc-900 first:mt-0">
            {e.phase}
            {e.round ? ` · round ${e.round}` : ""}
          </div>
        ) : e.type === "log" ? (
          <div
            key={i}
            className={cx(
              "whitespace-pre-wrap break-words",
              e.level === "dim" && "text-zinc-400",
              e.level === "warn" && "text-amber-700",
              e.level === "ok" && "text-emerald-700",
              e.level === "info" && "text-zinc-800",
            )}
          >
            <span className="mr-2 text-zinc-300">{new Date(e.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            {e.text}
          </div>
        ) : null,
      )}
      <div ref={bottom} />
    </div>
  );
}

// --- Report -----------------------------------------------------------------------

export function Report({ markdown }: { markdown?: string }) {
  if (!markdown) return <Empty>The report is written at the end.</Empty>;
  return (
    <article className="prose prose-zinc max-w-none rounded-xl border border-zinc-200 bg-white px-8 py-6 prose-headings:tracking-tight prose-a:break-all prose-table:text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </article>
  );
}
