import { useCallback, useEffect, useRef, useState } from "react";
import type { BriefEdit, DomainGuide, Health, ProfileFact, ProviderPreset, RunDetail, RunEvent, RunSummary, SearchOption, SettingsUpdate, SettingsView } from "../../src/shared.ts";

export type Preset = ProviderPreset;
type SettingsResponse = { settings: SettingsView; presets: Preset[]; searchOptions: SearchOption[] };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  health: () => request<Health>("/api/health"),
  runs: () => request<RunSummary[]>("/api/runs"),
  run: (id: string) => request<RunDetail>(`/api/runs/${encodeURIComponent(id)}`),
  startRun: (text: string) => request<RunSummary>("/api/runs", { method: "POST", body: JSON.stringify({ request: text }) }),
  addCandidate: (id: string, name: string, note: string) =>
    request<{ name: string; started: boolean }>(`/api/runs/${encodeURIComponent(id)}/candidates`, { method: "POST", body: JSON.stringify({ name, note }) }),
  addRemark: (id: string, name: string, text: string, links: string[]) =>
    request<{ name: string; started: boolean }>(`/api/runs/${encodeURIComponent(id)}/remarks`, { method: "POST", body: JSON.stringify({ name, text, links }) }),
  stop: (id: string) => request<{ ok: true }>(`/api/runs/${encodeURIComponent(id)}/stop`, { method: "POST" }),
  editBrief: (id: string, edit: BriefEdit) =>
    request<{ changes: string[]; next: "report" | "score" | "none" }>(`/api/runs/${encodeURIComponent(id)}/brief`, { method: "PUT", body: JSON.stringify(edit) }),
  resume: (id: string) => request<RunSummary>(`/api/runs/${encodeURIComponent(id)}/resume`, { method: "POST" }),
  answer: (id: string, questionId: string, answer: string) =>
    request<{ ok: true }>(`/api/runs/${encodeURIComponent(id)}/answer`, { method: "POST", body: JSON.stringify({ questionId, answer }) }),
  settings: () => request<SettingsResponse>("/api/settings"),
  saveSettings: (u: SettingsUpdate) => request<SettingsResponse>("/api/settings", { method: "PUT", body: JSON.stringify(u) }),
  testConnection: (target: "main" | "judge" | "search") =>
    request<{ ok: boolean; ms: number; detail: string }>("/api/settings/test", { method: "POST", body: JSON.stringify({ target }) }),
  models: (providerId: string) => request<{ models: string[] }>(`/api/settings/models?providerId=${encodeURIComponent(providerId)}`),
  guides: () => request<DomainGuide[]>("/api/domains"),
  guide: (name: string) => request<{ name: string; content: string }>(`/api/domains/${encodeURIComponent(name)}`),
  saveGuide: (name: string, content: string) => request<{ name: string }>(`/api/domains/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify({ content }) }),
  deleteGuide: (name: string) => request<{ ok: true }>(`/api/domains/${encodeURIComponent(name)}`, { method: "DELETE" }),
  draftGuide: (name: string) => request<{ name: string; content: string }>("/api/domains/draft", { method: "POST", body: JSON.stringify({ name }) }),
  profile: () => request<ProfileFact[]>("/api/profile"),
  saveProfile: (facts: ProfileFact[]) => request<ProfileFact[]>("/api/profile", { method: "PUT", body: JSON.stringify(facts) }),
  addFact: (text: string, scope?: string) => request<ProfileFact[]>("/api/profile", { method: "POST", body: JSON.stringify({ text, scope }) }),
};

/**
 * Live view of one run: initial fetch, then server-sent events.
 * Log lines are appended as they arrive; anything that changes state
 * triggers a (debounced) refetch of the full run detail.
 */
export function useRun(id: string) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const refresh = useCallback(() => {
    api
      .run(id)
      .then((d) => {
        setDetail(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    setDetail(null);
    const source = new EventSource(`/api/runs/${encodeURIComponent(id)}/events`);
    // Throttle (not debounce): during research, state changes arrive every
    // second or so, and a debounce would keep postponing the refresh forever.
    const scheduleRefresh = () => {
      if (timer.current !== undefined) return;
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        refresh();
      }, 500);
    };
    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as RunEvent;
      if (event.type === "log") {
        setDetail((d) => (d ? { ...d, events: [...d.events, event] } : d));
      } else {
        scheduleRefresh();
      }
    };
    refresh();
    return () => {
      source.close();
      window.clearTimeout(timer.current);
      timer.current = undefined;
    };
  }, [id, refresh]);

  return { detail, error, refresh };
}

/** Poll a value every `ms` milliseconds. */
export function usePolling<T>(load: () => Promise<T>, ms: number) {
  const [value, setValue] = useState<T | null>(null);
  const reload = useCallback(() => {
    load().then(setValue).catch(() => {});
  }, [load]);
  useEffect(() => {
    reload();
    const t = window.setInterval(reload, ms);
    return () => window.clearInterval(t);
  }, [reload, ms]);
  return { value, reload };
}
