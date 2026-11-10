import { useEffect, useState } from "react";
import type { ProfileFact } from "../../../src/shared.ts";
import { api } from "../api.ts";
import DomainGuides from "./DomainGuides.tsx";
import ModelSettings from "./ModelSettings.tsx";
import { Button, Chip, cx, Empty, timeAgo } from "./ui.tsx";

type Tab = "about" | "models" | "guides";

export default function ProfileView({ initialTab = "about" }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const tabs: { id: Tab; label: string }[] = [
    { id: "about", label: "About you" },
    { id: "models", label: "Models & search" },
    { id: "guides", label: "Domain guides" },
  ];
  return (
    <div className="mx-auto max-w-3xl px-8 pb-16 pt-12">
      <h1 className="text-2xl font-semibold tracking-tight">Profile & settings</h1>
      <div className="mt-6 flex gap-1 border-b border-zinc-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition",
              tab === t.id ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-6">
        {tab === "about" && <AboutYou />}
        {tab === "models" && <ModelSettings />}
        {tab === "guides" && <DomainGuides />}
      </div>
    </div>
  );
}

function AboutYou() {
  const [facts, setFacts] = useState<ProfileFact[] | null>(null);
  const [draft, setDraft] = useState("");
  const [draftScope, setDraftScope] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  useEffect(() => {
    api.profile().then(setFacts);
  }, []);

  async function add() {
    if (!draft.trim()) return;
    setFacts(await api.addFact(draft.trim(), draftScope.trim() || undefined));
    setDraft("");
  }

  async function save(next: ProfileFact[]) {
    setFacts(await api.saveProfile(next));
  }

  const groups = facts
    ? [
        { scope: undefined as string | undefined, items: facts.filter((f) => !f.scope) },
        ...[...new Set(facts.filter((f) => f.scope).map((f) => f.scope!))].sort().map((scope) => ({ scope, items: facts.filter((f) => f.scope === scope) })),
      ].filter((g) => g.items.length)
    : [];

  return (
    <div>
      <p className="text-zinc-600">
        What it knows about you. Preferences you state in an interview are saved here automatically (guesses are never saved), and the next
        interview uses them to skip questions and pre-fill suggestions. Product-specific preferences are kept under their product area.
      </p>
      <p className="mt-2 text-sm text-zinc-500">
        Tip: write facts as <code className="font-mono">topic: value</code> (e.g. <code className="font-mono">shoe size: UK 8</code>), so a
        newer fact on the same topic replaces the old one.
      </p>

      <div className="mt-8 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add a fact, e.g. OS: Android"
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500"
        />
        <input
          value={draftScope}
          onChange={(e) => setDraftScope(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="for (optional), e.g. smartphones"
          className="w-56 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500"
        />
        <Button onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>

      <div className="mt-6 space-y-6">
        {facts !== null && facts.length === 0 && <Empty>No facts yet. They'll appear here after your first interview.</Empty>}
        {groups.map((g) => (
          <div key={g.scope ?? "general"}>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{g.scope ? `For ${g.scope}` : "General"}</div>
            <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white">
              {g.items.map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-4 py-3">
                  {editing === f.id ? (
                    <input
                      autoFocus
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && facts) {
                          save(facts.map((x) => (x.id === f.id ? { ...x, text: editText, source: "user", updatedAt: new Date().toISOString() } : x)));
                          setEditing(null);
                        }
                        if (e.key === "Escape") setEditing(null);
                      }}
                      className="flex-1 rounded-md border border-zinc-300 px-2 py-1 text-sm outline-none focus:border-zinc-500"
                    />
                  ) : (
                    <span className="flex-1 text-sm text-zinc-800">{f.text}</span>
                  )}
                  <Chip tone={f.source === "user" ? "sky" : "zinc"}>{f.source === "user" ? "you" : "from interview"}</Chip>
                  <span className="w-16 text-right text-xs text-zinc-400">{timeAgo(f.updatedAt)}</span>
                  <Button
                    variant="ghost"
                    className="px-2 py-1"
                    onClick={() => {
                      setEditing(f.id);
                      setEditText(f.text);
                    }}
                  >
                    Edit
                  </Button>
                  <Button variant="ghost" className="px-2 py-1 hover:text-red-600" onClick={() => facts && save(facts.filter((x) => x.id !== f.id))}>
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
