import { useState } from "react";
import type { PendingQuestion } from "../../../src/shared.ts";
import { Button } from "./ui.tsx";

export default function QuestionCard({ question, onAnswer }: { question: PendingQuestion; onAnswer: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(answer: string) {
    if (!answer.trim() || busy) return;
    setBusy(true);
    try {
      await onAnswer(answer.trim());
      setText("");
    } finally {
      setBusy(false);
    }
  }

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

      {question.options?.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {question.options.map((o) => (
            <button
              key={o}
              disabled={busy}
              onClick={() => submit(o)}
              className="rounded-full border border-zinc-300 bg-white px-3.5 py-1.5 text-sm text-zinc-800 transition hover:border-zinc-900 hover:bg-zinc-900 hover:text-white"
            >
              {o}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex items-end gap-2">
        <textarea
          autoFocus
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(text);
            }
          }}
          placeholder={question.suggestion || question.options?.length ? "Or type your own answer..." : "Type your answer..."}
          className="min-h-[42px] flex-1 resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500"
        />
        <Button onClick={() => submit(text)} disabled={busy || !text.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}
