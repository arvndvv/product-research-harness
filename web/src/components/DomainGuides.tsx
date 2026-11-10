import { useEffect, useState } from "react";
import type { DomainGuide } from "../../../src/shared.ts";
import { api } from "../api.ts";
import { Button, cx, Empty, timeAgo } from "./ui.tsx";

/**
 * Domain guides: expert notes per product category (domains/<name>.md), added
 * to the research prompts whenever the category matches the guide's name.
 */
export default function DomainGuides() {
  const [guides, setGuides] = useState<DomainGuide[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = () => api.guides().then(setGuides);
  useEffect(() => {
    reload();
  }, []);

  async function open(g: string) {
    setMessage(null);
    const r = await api.guide(g);
    setSelected(g);
    setIsNew(false);
    setName(g);
    setContent(r.content);
    setSavedContent(r.content);
  }

  function startNew() {
    setMessage(null);
    setSelected(null);
    setIsNew(true);
    setName("");
    setContent("");
    setSavedContent("");
  }

  async function save() {
    setBusy("save");
    setMessage(null);
    try {
      const r = await api.saveGuide(name, content);
      setSelected(r.name);
      setName(r.name);
      setIsNew(false);
      setSavedContent(content);
      setMessage({ ok: true, text: `Saved. Used from the next research in a matching category.` });
      reload();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function draft() {
    setBusy("draft");
    setMessage(null);
    try {
      const r = await api.draftGuide(name);
      setName(r.name);
      setContent(r.content);
      setMessage({ ok: true, text: "Draft written by the judge model from its general knowledge. Check it, fix anything wrong, then save." });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!selected || !window.confirm(`Delete the "${selected}" guide?`)) return;
    await api.deleteGuide(selected);
    setSelected(null);
    setIsNew(false);
    setContent("");
    reload();
  }

  const editing = isNew || selected !== null;
  const dirty = content !== savedContent;

  return (
    <div>
      <p className="text-sm text-zinc-600">
        Expert notes for a product category: what really matters, which sources to trust, common pitfalls. A guide is added to the research
        whenever the product category contains its name, e.g. a guide named <code className="font-mono">smartphones</code> is used for
        "smartphone" and "gaming smartphones". Guides are plain Markdown files in <code className="font-mono">domains/</code>.
      </p>

      <div className="mt-6 grid gap-6 md:grid-cols-[200px_1fr]">
        <div>
          <Button variant="secondary" className="w-full" onClick={startNew}>
            + New guide
          </Button>
          <ul className="mt-3 space-y-1">
            {guides?.length === 0 && <li className="px-2 text-sm text-zinc-400">No guides yet.</li>}
            {guides?.map((g) => (
              <li key={g.name}>
                <button
                  onClick={() => open(g.name)}
                  className={cx("w-full rounded-lg px-3 py-2 text-left text-sm transition", selected === g.name ? "bg-zinc-100 font-medium" : "hover:bg-zinc-50")}
                >
                  {g.name}
                  <span className="block text-xs font-normal text-zinc-400">updated {timeAgo(g.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          {!editing ? (
            <Empty>Pick a guide to edit, or create a new one.</Empty>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex-1">
                  <span className="text-sm font-medium">Category name</span>
                  <input
                    value={name}
                    disabled={!isNew}
                    onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))}
                    placeholder="e.g. smartphones, laptops, air-purifiers"
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-zinc-500 disabled:bg-zinc-50"
                  />
                </label>
                <Button variant="secondary" onClick={draft} disabled={!name || busy !== null}>
                  {busy === "draft" ? "Drafting..." : "Draft with AI"}
                </Button>
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={22}
                placeholder={"# Domain guide: smartphones\n\n## What actually matters\n- ...\n\n## Sources\n- ...\n\n## Pitfalls\n- ..."}
                className="scroll-thin w-full rounded-xl border border-zinc-300 bg-white p-4 font-mono text-sm leading-relaxed outline-none focus:border-zinc-500"
              />
              {message && <p className={cx("text-sm", message.ok ? "text-emerald-700" : "text-red-700")}>{message.text}</p>}
              <div className="flex flex-wrap gap-2">
                <Button onClick={save} disabled={!name || !content.trim() || !dirty || busy !== null}>
                  {busy === "save" ? "Saving..." : "Save guide"}
                </Button>
                {selected && (
                  <Button variant="ghost" className="hover:text-red-600" onClick={remove}>
                    Delete
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
