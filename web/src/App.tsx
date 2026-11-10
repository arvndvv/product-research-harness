import { useCallback, useEffect, useState } from "react";
import { api, usePolling } from "./api.ts";
import NewResearch from "./components/NewResearch.tsx";
import ProfileView from "./components/ProfileView.tsx";
import RunView from "./components/RunView.tsx";
import { cx, StatusDot, timeAgo } from "./components/ui.tsx";

type Route = { view: "new" } | { view: "profile" } | { view: "settings" } | { view: "run"; id: string };

function parseHash(): Route {
  const h = decodeURIComponent(window.location.hash.replace(/^#\/?/, ""));
  if (h === "profile") return { view: "profile" };
  if (h === "settings") return { view: "settings" };
  if (h.startsWith("run/")) return { view: "run", id: h.slice(4) };
  return { view: "new" };
}

function navigate(route: Route) {
  window.location.hash = route.view === "run" ? `/run/${encodeURIComponent(route.id)}` : `/${route.view}`;
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const loadRuns = useCallback(() => api.runs(), []);
  const { value: runs, reload: reloadRuns } = usePolling(loadRuns, 3000);
  const loadHealth = useCallback(() => api.health(), []);
  const { value: health } = usePolling(loadHealth, 5000);

  return (
    <div className="flex h-full">
      <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-200 bg-white">
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-zinc-900 text-white">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="10.5" cy="10.5" r="5.5" />
              <path d="M15 15l5 5" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">Product Research</div>
            <div className="text-xs text-zinc-500">finds the one that fits you</div>
          </div>
        </div>

        <div className="space-y-1 px-3">
          <NavItem active={route.view === "new"} onClick={() => navigate({ view: "new" })}>
            <span className="text-base leading-none">+</span> New research
          </NavItem>
          <NavItem active={route.view === "profile" || route.view === "settings"} onClick={() => navigate({ view: "profile" })}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
            </svg>
            Profile & settings
          </NavItem>
        </div>

        <div className="mt-6 px-5 pb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">Research</div>
        <nav className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {runs?.length === 0 && <p className="px-2 py-1 text-sm text-zinc-400">Nothing yet.</p>}
          {runs?.map((r) => (
            <button
              key={r.id}
              onClick={() => navigate({ view: "run", id: r.id })}
              className={cx(
                "block w-full rounded-lg px-3 py-2 text-left transition",
                route.view === "run" && route.id === r.id ? "bg-zinc-100" : "hover:bg-zinc-50",
              )}
            >
              <div className="flex items-center gap-2">
                <StatusDot status={r.status} />
                <span className="truncate text-sm font-medium text-zinc-800">{r.category ?? r.request}</span>
              </div>
              <div className="mt-0.5 truncate pl-4 text-xs text-zinc-500">
                {r.winner ? `→ ${r.winner}` : r.status === "waiting" ? "Waiting for your answer" : r.phase} · {timeAgo(r.createdAt)}
              </div>
            </button>
          ))}
        </nav>

        {health && (
          <div className="border-t border-zinc-200 px-5 py-3 text-xs text-zinc-500">
            {health.missing.length ? (
              <button onClick={() => navigate({ view: "settings" })} className="text-left text-red-600 hover:underline">
                Setup needed: {health.missing.join(", ")}
              </button>
            ) : (
              <span>
                {health.mainModel}
                {health.judgeModel !== health.mainModel && ` + ${health.judgeModel}`} · {health.search}
              </span>
            )}
          </div>
        )}
      </aside>

      <main className="scroll-thin min-w-0 flex-1 overflow-y-auto">
        {route.view === "new" && (
          <NewResearch
            health={health}
            onStarted={(id) => {
              reloadRuns();
              navigate({ view: "run", id });
            }}
          />
        )}
        {route.view === "profile" && <ProfileView key="profile" />}
        {route.view === "settings" && <ProfileView key="settings" initialTab="models" />}
        {route.view === "run" && <RunView key={route.id} id={route.id} onChange={reloadRuns} />}
      </main>
    </div>
  );
}

function NavItem({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
        active ? "bg-zinc-100 text-zinc-900" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900",
      )}
    >
      {children}
    </button>
  );
}
