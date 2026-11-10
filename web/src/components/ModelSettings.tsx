import { useEffect, useState } from "react";
import type { ModelChoice, SearchOption, SearchProvider, SettingsView, SetupGuide } from "../../../src/shared.ts";
import { api, type Preset } from "../api.ts";
import { Button, Chip, cx } from "./ui.tsx";

type TestResult = { ok: boolean; ms: number; detail: string } | "running" | null;

/**
 * Models & search. Everything here is stored in settings.json on this machine
 * and takes effect on the next model call. Keys are never shown again after
 * saving, only their last 4 characters.
 */
export default function ModelSettings() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [searchOptions, setSearchOptions] = useState<SearchOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    api
      .settings()
      .then((r) => {
        setView(r.settings);
        setPresets(r.presets);
        setSearchOptions(r.searchOptions);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  async function save(update: Parameters<typeof api.saveSettings>[0], message: string) {
    setError(null);
    setSaved(null);
    try {
      const r = await api.saveSettings(update);
      setView(r.settings);
      setSaved(message);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  if (!view) return <p className="text-sm text-zinc-500">{error ?? "Loading..."}</p>;

  return (
    <div className="space-y-10">
      <p className="text-sm text-zinc-600">
        Any service with an OpenAI-compatible API and tool calling works: the presets below, or any other through "Custom". Settings are
        saved in <code className="font-mono">settings.json</code> on this machine and apply to the next step of any research, with no restart.
      </p>
      {(!view.providers.some((p) => p.keyHint || /localhost|127\.0\.0\.1/.test(p.baseUrl)) || !hasSearchKey(view)) && <QuickStart />}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div>}
      {saved && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">{saved}</div>}

      <Providers view={view} presets={presets} onSave={save} />
      <ModelChoices view={view} presets={presets} onSave={save} />
      <SearchSettings view={view} options={searchOptions} onSave={save} />
    </div>
  );
}

type SaveFn = (update: Parameters<typeof api.saveSettings>[0], message: string) => Promise<boolean>;

// --- Providers -------------------------------------------------------------------

function Providers({ view, presets, onSave }: { view: SettingsView; presets: Preset[]; onSave: SaveFn }) {
  const [editing, setEditing] = useState<string | "new" | null>(view.providers.length ? null : "new");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");

  function startNew(preset?: Preset) {
    setEditing("new");
    setName(preset?.name ?? "");
    setBaseUrl(preset?.baseUrl ?? "");
    setApiKey("");
  }
  function startEdit(id: string) {
    const p = view.providers.find((x) => x.id === id)!;
    setEditing(id);
    setName(p.name);
    setBaseUrl(p.baseUrl);
    setApiKey("");
  }

  const list = () => view.providers.map((p) => ({ id: p.id, name: p.name, baseUrl: p.baseUrl }));

  async function submit() {
    const providers =
      editing === "new"
        ? [...list(), { name, baseUrl, apiKey }]
        : list().map((p) => (p.id === editing ? { ...p, name, baseUrl, apiKey } : p));
    if (await onSave({ providers }, `Saved ${name}.`)) setEditing(null);
  }

  async function remove(id: string) {
    const p = view.providers.find((x) => x.id === id)!;
    if (!window.confirm(`Remove ${p.name}? Models using it will need a new provider.`)) return;
    await onSave({ providers: list().filter((x) => x.id !== id) }, `Removed ${p.name}.`);
  }

  async function clearKey(id: string) {
    await onSave({ providers: list().map((p) => (p.id === id ? { ...p, apiKey: null } : p)) }, "Key removed.");
  }

  return (
    <section>
      <h2 className="font-semibold">AI providers</h2>
      <p className="mt-1 text-sm text-zinc-500">Where the models run. Add one or more, then choose models below.</p>

      <ul className="mt-4 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white">
        {view.providers.length === 0 && <li className="px-4 py-3 text-sm text-zinc-500">No providers yet.</li>}
        {view.providers.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{p.name}</div>
              <div className="truncate font-mono text-xs text-zinc-500">{p.baseUrl}</div>
            </div>
            {p.keyHint ? <Chip tone="green">key {p.keyHint}</Chip> : <Chip tone={/localhost|127\.0\.0\.1/.test(p.baseUrl) ? "zinc" : "amber"}>no key</Chip>}
            <Button variant="ghost" className="px-2 py-1" onClick={() => startEdit(p.id)}>
              Edit
            </Button>
            {p.keyHint && (
              <Button variant="ghost" className="px-2 py-1" onClick={() => clearKey(p.id)}>
                Remove key
              </Button>
            )}
            <Button variant="ghost" className="px-2 py-1 hover:text-red-600" onClick={() => remove(p.id)}>
              Delete
            </Button>
          </li>
        ))}
      </ul>

      {editing ? (
        <div className="mt-4 space-y-3 rounded-xl border border-zinc-300 bg-white p-4">
          {editing === "new" && (
            <div className="flex flex-wrap gap-2">
              {presets.map((pr) => (
                <button
                  key={pr.name}
                  onClick={() => startNew(pr)}
                  className={cx("rounded-full border px-3 py-1 text-xs transition", baseUrl === pr.baseUrl ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 hover:border-zinc-500")}
                >
                  {pr.name}
                </button>
              ))}
              <button onClick={() => startNew()} className="rounded-full border border-dashed border-zinc-300 px-3 py-1 text-xs hover:border-zinc-500">
                Custom
              </button>
            </div>
          )}
          {(() => {
            const preset = presets.find((pr) => pr.baseUrl === baseUrl.trim().replace(/\/$/, ""));
            return preset ? <GuideBox title={`Getting a ${preset.name} key`} guide={preset.guide} open={editing === "new"} /> : null;
          })()}
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mistral" className={inputCls} />
          </Field>
          <Field label="Base URL" hint="The OpenAI-compatible API address, usually ending in /v1.">
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.mistral.ai/v1" className={cx(inputCls, "font-mono")} />
          </Field>
          <Field label="API key" hint={editing !== "new" ? "Leave empty to keep the current key." : "Not needed for local servers like Ollama."}>
            <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={editing !== "new" ? "unchanged" : "paste your key"} className={cx(inputCls, "font-mono")} />
          </Field>
          <div className="flex gap-2">
            <Button onClick={submit} disabled={!name.trim() || !baseUrl.trim()}>
              Save provider
            </Button>
            {view.providers.length > 0 && (
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Button variant="secondary" className="mt-3" onClick={() => startNew(presets[0])}>
          + Add provider
        </Button>
      )}
    </section>
  );
}

// --- Model choices ---------------------------------------------------------------------

function ModelChoices({ view, presets, onSave }: { view: SettingsView; presets: Preset[]; onSave: SaveFn }) {
  const first = view.providers[0]?.id ?? "";
  const [main, setMain] = useState<ModelChoice>(view.main ?? { providerId: first, model: "" });
  const [judgeSame, setJudgeSame] = useState(!view.judge);
  const [judge, setJudge] = useState<ModelChoice>(view.judge ?? view.main ?? { providerId: first, model: "" });
  const [tests, setTests] = useState<Record<string, TestResult>>({});

  useEffect(() => {
    if (!main.providerId && first) setMain({ ...main, providerId: first });
  }, [first]);

  async function saveChoices() {
    await onSave({ main, judge: judgeSame ? null : judge }, "Model choices saved. They apply to the next step of any research.");
  }

  async function test(target: "main" | "judge") {
    setTests((t) => ({ ...t, [target]: "running" }));
    const r = await api.testConnection(target).catch((e: Error) => ({ ok: false, ms: 0, detail: e.message }));
    setTests((t) => ({ ...t, [target]: r }));
  }

  if (!view.providers.length) return null;

  return (
    <section>
      <h2 className="font-semibold">Which model does what</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Research makes many calls with tool use; judging makes a few calls where reasoning quality matters most. A cheaper or local model for
        research and a stronger one for judging is a good split.
      </p>
      <div className="mt-4 space-y-4 rounded-xl border border-zinc-200 bg-white p-4">
        <ModelPicker label="Research model" hint="Interview, finding products, researching each one" choice={main} onChange={setMain} view={view} presets={presets} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={judgeSame} onChange={(e) => setJudgeSame(e.target.checked)} className="accent-zinc-900" />
          Use the same model for judging
        </label>
        {!judgeSame && (
          <ModelPicker label="Judge model" hint="Shortlisting, scoring, reviewing the decision, writing the report" choice={judge} onChange={setJudge} view={view} presets={presets} />
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button onClick={saveChoices} disabled={!main.model.trim() || (!judgeSame && !judge.model.trim())}>
            Save model choices
          </Button>
          <Button variant="secondary" onClick={() => test("main")} disabled={tests.main === "running"}>
            Test research model
          </Button>
          {!judgeSame && (
            <Button variant="secondary" onClick={() => test("judge")} disabled={tests.judge === "running"}>
              Test judge model
            </Button>
          )}
        </div>
        <p className="text-xs text-zinc-500">Tests use the saved settings: save first.</p>
        <TestLine result={tests.main} label="Research model" />
        {!judgeSame && <TestLine result={tests.judge} label="Judge model" />}
      </div>
    </section>
  );
}

function ModelPicker({
  label,
  hint,
  choice,
  onChange,
  view,
  presets,
}: {
  label: string;
  hint: string;
  choice: ModelChoice;
  onChange: (c: ModelChoice) => void;
  view: SettingsView;
  presets: Preset[];
}) {
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const provider = view.providers.find((p) => p.id === choice.providerId);
  const example = presets.find((p) => p.baseUrl === provider?.baseUrl)?.example;
  const listId = `models-${label.replace(/\s/g, "")}`;

  async function load() {
    if (!choice.providerId) return;
    setLoading(true);
    setLoadError(null);
    try {
      setModels((await api.models(choice.providerId)).models);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="text-sm font-medium">{label}</div>
      <div className="text-xs text-zinc-500">{hint}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        <select
          value={choice.providerId}
          onChange={(e) => {
            onChange({ providerId: e.target.value, model: "" });
            setModels([]);
          }}
          className={cx(inputCls, "w-56")}
        >
          {view.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          list={listId}
          value={choice.model}
          onChange={(e) => onChange({ ...choice, model: e.target.value })}
          placeholder={example ? `model name, e.g. ${example}` : "model name"}
          className={cx(inputCls, "min-w-64 flex-1 font-mono")}
        />
        <datalist id={listId}>
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <Button variant="ghost" onClick={load} disabled={loading || !choice.providerId}>
          {loading ? "Loading..." : models.length ? `${models.length} models` : "Load models"}
        </Button>
      </div>
      {loadError && <p className="mt-1 text-xs text-red-600">Couldn't load the model list: {loadError}. You can still type a model name.</p>}
    </div>
  );
}

// --- Search -----------------------------------------------------------------------------

function SearchSettings({ view, options, onSave }: { view: SettingsView; options: SearchOption[]; onSave: SaveFn }) {
  const [provider, setProvider] = useState<SearchProvider>(view.search.provider);
  const [tavilyKey, setTavilyKey] = useState("");
  const [exaKey, setExaKey] = useState("");
  const [braveKey, setBraveKey] = useState("");
  const [searxngUrl, setSearxngUrl] = useState(view.search.searxngUrl ?? "http://localhost:8080");
  const [test, setTest] = useState<TestResult>(null);

  const selected = options.find((o) => o.id === provider);

  async function save() {
    await onSave({ search: { provider, tavilyKey, exaKey, braveKey, searxngUrl } }, "Search settings saved.");
    setTavilyKey("");
    setExaKey("");
    setBraveKey("");
  }

  async function runTest() {
    setTest("running");
    setTest(await api.testConnection("search").catch((e: Error) => ({ ok: false, ms: 0, detail: e.message })));
  }

  return (
    <section>
      <h2 className="font-semibold">Web search</h2>
      <p className="mt-1 text-sm text-zinc-500">How the research agents search the web.</p>
      <div className="mt-4 space-y-4 rounded-xl border border-zinc-200 bg-white p-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {options.map((o) => (
            <button
              key={o.id}
              onClick={() => setProvider(o.id)}
              className={cx("rounded-lg border p-3 text-left transition", provider === o.id ? "border-zinc-900 ring-1 ring-zinc-900" : "border-zinc-200 hover:border-zinc-400")}
            >
              <div className="text-sm font-medium">{o.name}</div>
              <div className="mt-0.5 text-xs text-zinc-500">{o.note}</div>
            </button>
          ))}
        </div>
        {selected && <GuideBox title={`Setting up ${selected.name}`} guide={selected.guide} open={!keyHintFor(view, provider)} />}
        {provider === "tavily" && (
          <Field label="Tavily API key" hint={view.search.tavilyKeyHint ? `Current key ${view.search.tavilyKeyHint}. Leave empty to keep it.` : undefined}>
            <input type="password" autoComplete="off" value={tavilyKey} onChange={(e) => setTavilyKey(e.target.value)} placeholder={view.search.tavilyKeyHint ? "unchanged" : "tvly-..."} className={cx(inputCls, "font-mono")} />
          </Field>
        )}
        {provider === "exa" && (
          <Field label="Exa API key" hint={view.search.exaKeyHint ? `Current key ${view.search.exaKeyHint}. Leave empty to keep it.` : undefined}>
            <input type="password" autoComplete="off" value={exaKey} onChange={(e) => setExaKey(e.target.value)} placeholder={view.search.exaKeyHint ? "unchanged" : "paste your key"} className={cx(inputCls, "font-mono")} />
          </Field>
        )}
        {provider === "brave" && (
          <Field label="Brave Search API key" hint={view.search.braveKeyHint ? `Current key ${view.search.braveKeyHint}. Leave empty to keep it.` : undefined}>
            <input type="password" autoComplete="off" value={braveKey} onChange={(e) => setBraveKey(e.target.value)} placeholder={view.search.braveKeyHint ? "unchanged" : "paste your key"} className={cx(inputCls, "font-mono")} />
          </Field>
        )}
        {provider === "searxng" && (
          <Field label="SearXNG URL">
            <input value={searxngUrl} onChange={(e) => setSearxngUrl(e.target.value)} className={cx(inputCls, "font-mono")} />
          </Field>
        )}
        <div className="flex gap-2">
          <Button onClick={save}>Save search settings</Button>
          <Button variant="secondary" onClick={runTest} disabled={test === "running"}>
            Test search
          </Button>
        </div>
        <TestLine result={test} label="Search" />
      </div>
    </section>
  );
}

// --- Setup help ------------------------------------------------------------------------------

function keyHintFor(view: SettingsView, provider: SearchProvider) {
  if (provider === "searxng") return view.search.searxngUrl;
  return { tavily: view.search.tavilyKeyHint, exa: view.search.exaKeyHint, brave: view.search.braveKeyHint }[provider];
}

function hasSearchKey(view: SettingsView) {
  return Boolean(keyHintFor(view, view.search.provider));
}

/** Shown until a model provider and search are set up: the cheapest way to get going. */
function QuickStart() {
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
      <div className="font-semibold">Getting started for free</div>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          <b>AI:</b> get a free Mistral key (Experiment plan, no card) and add it under AI providers. Groq and Google Gemini also have free tiers.
        </li>
        <li>
          <b>Search:</b> get a free Tavily key (1,000 searches a month, no card) and add it under Web search. Exa is a free alternative.
        </li>
        <li>Choose the models, press the Test buttons, and start a research.</li>
      </ol>
      <p className="mt-2 text-xs text-sky-900/80">Step-by-step help appears when you pick a provider below. Free tiers change; each guide links to the provider's own page.</p>
    </div>
  );
}

function GuideBox({ title, guide, open }: { title: string; guide: SetupGuide; open?: boolean }) {
  return (
    <details open={open} className="group rounded-lg border border-zinc-200 bg-zinc-50 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium text-zinc-800">
        <span className="text-zinc-400 transition group-open:rotate-90">▸</span>
        {title}
        {guide.free ? <Chip tone="green">free option</Chip> : <Chip tone="zinc">paid</Chip>}
      </summary>
      <div className="space-y-2 px-3 pb-3 text-zinc-700">
        {guide.free && <p>{guide.free}</p>}
        <ol className="list-decimal space-y-1 pl-5">
          {guide.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        {guide.note && <p className="text-xs text-amber-800">{guide.note}</p>}
        {guide.link && (
          <a href={guide.link.url} target="_blank" rel="noreferrer" className="inline-block rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium hover:border-zinc-500">
            Open {guide.link.label} ↗
          </a>
        )}
      </div>
    </details>
  );
}

// --- Small pieces ----------------------------------------------------------------------------

const inputCls = "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1 [&>input]:w-full">{children}</div>
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

function TestLine({ result, label }: { result: TestResult | undefined; label: string }) {
  if (!result) return null;
  if (result === "running") return <p className="text-sm text-zinc-500">{label}: testing...</p>;
  return (
    <p className={cx("text-sm", result.ok ? "text-emerald-700" : "text-red-700")}>
      {label}: {result.ok ? "works" : "failed"} ({Math.round(result.ms)} ms). {result.detail}
    </p>
  );
}
