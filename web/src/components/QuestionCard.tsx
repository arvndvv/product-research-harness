import { useEffect, useRef, useState } from "react";
import type { PendingQuestion } from "../../../src/shared.ts";
import { Button, cx } from "./ui.tsx";

/**
 * The interview question. Quick-reply options are multi-select: clicking one
 * toggles it and shows it as a chip in the answer box (remove the chip to
 * unselect). Send joins the chips and any typed text with commas.
 */
export default function QuestionCard({ question, onAnswer }: { question: PendingQuestion; onAnswer: (text: string) => Promise<void> }) {
  if (question.longlist) return <LonglistReview question={question} onAnswer={onAnswer} />;
  return <InterviewQuestion question={question} onAnswer={onAnswer} />;
}

const ANGLE: Record<string, string> = {
  expert_review: "expert reviews",
  community: "owner threads",
  retailer_list: "retailer lists",
  new_launch: "recent launch",
  earlier_research: "earlier research",
  other: "other",
};

/**
 * After discovery: the person sees every product found before anything is cut.
 * They can remove products, add their own (always researched), or ask for more
 * searching with a hint. The reply is JSON; see parseLonglistReview.
 */
function LonglistReview({ question, onAnswer }: { question: PendingQuestion; onAnswer: (text: string) => Promise<void> }) {
  const items = question.longlist ?? [];
  const [removed, setRemoved] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRemoved([]);
    setAdded([]);
    setDraft("");
    setHint("");
  }, [question.id]);

  const toggle = (name: string) => setRemoved((r) => (r.includes(name) ? r.filter((x) => x !== name) : [...r, name]));
  function addDraft() {
    const names = draft.split(",").map((s) => s.trim()).filter((s) => s.length >= 2 && !added.includes(s));
    if (names.length) setAdded((a) => [...a, ...names]);
    setDraft("");
  }
  async function send(action: "continue" | "more") {
    if (busy) return;
    setBusy(true);
    try {
      const pendingAdd = draft.split(",").map((s) => s.trim()).filter((s) => s.length >= 2);
      await onAnswer(JSON.stringify({ action, remove: removed, add: [...added, ...pendingAdd.filter((s) => !added.includes(s))], hint: hint.trim() }));
    } finally {
      setBusy(false);
    }
  }
  const kept = items.length - removed.length + added.length;

  return (
    <div className="rounded-2xl border border-amber-300 bg-white p-5 shadow-sm ring-4 ring-amber-50">
      <div className="mb-1 flex items-center justify-between gap-3 text-xs font-medium uppercase tracking-wide text-amber-700">
        <span>Your turn · check the list</span>
        <span className="normal-case tracking-normal text-zinc-400">{kept} products</span>
      </div>
      <p className="text-base leading-snug text-zinc-900">{question.question}</p>

      <ul className="scroll-thin mt-4 max-h-[26rem] divide-y divide-zinc-100 overflow-auto rounded-xl border border-zinc-200">
        {items.map((c) => {
          const off = removed.includes(c.name);
          return (
            <li key={c.name} className={cx("flex items-start gap-3 px-3 py-2.5", off && "bg-zinc-50")}>
              <div className={cx("min-w-0 flex-1", off && "opacity-50")}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={cx("text-sm font-medium text-zinc-900", off && "line-through")}>{c.name}</span>
                  {c.price && <span className="text-xs text-zinc-500">{c.price}</span>}
                </div>
                <div className="truncate text-xs text-zinc-500" title={c.why}>
                  {c.foundVia.length ? `${c.foundVia.map((v) => ANGLE[v] ?? v).join(", ")} · ` : ""}
                  {c.why}
                </div>
              </div>
              <button
                onClick={() => toggle(c.name)}
                className={cx(
                  "shrink-0 rounded-md border px-2 py-0.5 text-xs transition",
                  off ? "border-zinc-300 text-zinc-700 hover:border-zinc-500" : "border-transparent text-zinc-400 hover:border-red-200 hover:text-red-600",
                )}
              >
                {off ? "Undo" : "Remove"}
              </button>
            </li>
          );
        })}
        {added.map((name) => (
          <li key={`add-${name}`} className="flex items-center gap-3 bg-sky-50/50 px-3 py-2.5">
            <span className="flex-1 text-sm font-medium text-zinc-900">
              {name} <span className="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-normal text-sky-800">added by you</span>
            </span>
            <button onClick={() => setAdded((a) => a.filter((x) => x !== name))} className="text-xs text-zinc-400 hover:text-red-600">
              Remove
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addDraft())}
          placeholder="Add a product, e.g. ASUS Zenbook 14 (separate several with commas)"
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
        />
        <Button variant="secondary" onClick={addDraft} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
      <p className="mt-1 text-xs text-zinc-500">Products you add are always researched, even beyond the usual shortlist limit.</p>

      {question.details && (
        <details className="mt-3 text-xs text-zinc-500">
          <summary className="cursor-pointer">How the search went</summary>
          <pre className="mt-1 whitespace-pre-wrap font-sans">{question.details.split("\n\n").slice(1, 2).join("")}</pre>
        </details>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4">
        <Button onClick={() => send("continue")} disabled={busy || kept < 1}>
          {busy ? "Sending..." : `Continue with ${kept} products`}
        </Button>
        <span className="text-xs text-zinc-400">or</span>
        <input
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          placeholder="What else to look for (optional), e.g. OLED models, Apple, gaming"
          className="min-w-[14rem] flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
        />
        <Button variant="secondary" onClick={() => send("more")} disabled={busy}>
          Search for more
        </Button>
      </div>
    </div>
  );
}

function InterviewQuestion({ question, onAnswer }: { question: PendingQuestion; onAnswer: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // A new question starts with nothing selected.
  useEffect(() => {
    setSelected([]);
    setText("");
  }, [question.id]);

  const answer = [...selected, text.trim()].filter(Boolean).join(", ");

  async function submit(value: string) {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      await onAnswer(value.trim());
      setText("");
      setSelected([]);
    } finally {
      setBusy(false);
    }
  }

  function toggle(option: string) {
    setSelected((s) => (s.includes(option) ? s.filter((x) => x !== option) : [...s, option]));
    inputRef.current?.focus();
  }

  const options = question.options ?? [];
  const allSelected = options.length > 1 && options.every((o) => selected.includes(o));

  return (
    <div className="rounded-2xl border border-amber-300 bg-white p-5 shadow-sm ring-4 ring-amber-50">
      <div className="mb-1 flex items-center justify-between gap-3 text-xs font-medium uppercase tracking-wide text-amber-700">
        <span>Your turn</span>
        {question.progress && <span className="normal-case tracking-normal text-zinc-400">{question.progress}</span>}
      </div>
      <p className="text-lg font-medium leading-snug text-zinc-900">{question.question}</p>

      {question.details && (
        <pre className="scroll-thin mt-4 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-4 font-sans text-sm leading-relaxed text-zinc-700">
          {question.details}
        </pre>
      )}

      {question.suggestion && (
        <button
          disabled={busy}
          onClick={() => submit(question.suggestion!)}
          className="mt-4 flex w-full items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left transition hover:border-emerald-300 hover:bg-emerald-100"
        >
          <span>
            <span className="block text-xs font-medium text-emerald-700">Suggested from what it knows about you</span>
            <span className="text-sm text-emerald-950">{question.suggestion}</span>
          </span>
          <span className="shrink-0 text-sm font-medium text-emerald-800">Use this →</span>
        </button>
      )}

      {options.length ? (
        <div className="mt-4">
          <div className="flex flex-wrap gap-2">
            {options.map((o) => {
              const on = selected.includes(o);
              return (
                <button
                  key={o}
                  disabled={busy}
                  aria-pressed={on}
                  onClick={() => toggle(o)}
                  className={cx(
                    "rounded-full border px-3.5 py-1.5 text-sm transition",
                    on ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-800 hover:border-zinc-500",
                  )}
                >
                  {on && <span className="mr-1">✓</span>}
                  {o}
                </button>
              );
            })}
            {options.length > 2 && (
              <button
                disabled={busy}
                onClick={() => setSelected(allSelected ? [] : [...options])}
                className="rounded-full border border-dashed border-zinc-300 px-3.5 py-1.5 text-sm text-zinc-500 transition hover:border-zinc-500 hover:text-zinc-800"
              >
                {allSelected ? "Clear all" : "Select all"}
              </button>
            )}
          </div>
          <p className="mt-1.5 text-xs text-zinc-500">Pick one or more, add anything else below, then send.</p>
        </div>
      ) : null}

      <div className="mt-4 flex items-end gap-2">
        <div
          onClick={() => inputRef.current?.focus()}
          className="flex min-h-[42px] flex-1 cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 focus-within:border-zinc-500"
        >
          {selected.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pl-2.5 pr-1 text-sm text-zinc-800">
              {s}
              <button
                aria-label={`Remove ${s}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(s);
                }}
                className="grid h-4 w-4 place-items-center rounded-full text-xs text-zinc-500 hover:bg-zinc-300 hover:text-zinc-900"
              >
                ×
              </button>
            </span>
          ))}
          <textarea
            ref={inputRef}
            autoFocus
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(answer);
              } else if (e.key === "Backspace" && !text && selected.length) {
                // Backspace in an empty box removes the last chip, like a tag input.
                setSelected((s) => s.slice(0, -1));
              }
            }}
            placeholder={selected.length ? "Add more (optional)..." : question.suggestion || options.length ? "Or type your own answer..." : "Type your answer..."}
            className="min-w-[10rem] flex-1 resize-none bg-transparent px-1 py-0.5 text-sm outline-none"
          />
        </div>
        <Button onClick={() => submit(answer)} disabled={busy || !answer}>
          Send
        </Button>
      </div>
    </div>
  );
}
