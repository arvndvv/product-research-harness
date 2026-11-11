/**
 * Web tools: search + fetch (with special handling for Reddit threads).
 * Each research task gets its own fetch budget, a simple cost guardrail.
 */
import { config } from "../config.ts";
import { requestSignal } from "../context.ts";
import { searchSettings } from "../settings.ts";
import { tool, type Tool } from "../loop.ts";
import { htmlToText } from "../util/html.ts";

const UA = "Mozilla/5.0 (compatible; research-harness/0.1; personal research tool)";

export type SearchResult = { title: string; url: string; snippet: string };

let searchImpl: ((query: string, max: number) => Promise<SearchResult[]>) | null = null;
/** Test/demo hook: replace web search (null restores the real one). */
export function setSearchImpl(fn: typeof searchImpl) {
  searchImpl = fn;
}

export async function search(query: string, max = 8): Promise<SearchResult[]> {
  if (searchImpl) return searchImpl(query, max);
  const s = searchSettings();
  const timeout = requestSignal(30_000);

  if (s.provider === "tavily") {
    if (!s.tavilyKey) throw new Error("TAVILY_API_KEY is not set");
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.tavilyKey}` },
      body: JSON.stringify({ query, max_results: max, search_depth: "basic" }),
      signal: timeout,
    });
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data: any = await res.json();
    return (data.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.content ?? "" }));
  }

  if (s.provider === "exa") {
    if (!s.exaKey) throw new Error("EXA_API_KEY is not set");
    const res = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": s.exaKey },
      body: JSON.stringify({ query, numResults: max, type: "auto", contents: { highlights: true } }),
      signal: timeout,
    });
    if (!res.ok) throw new Error(`Exa HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data: any = await res.json();
    return (data.results ?? []).map((r: any) => ({
      title: r.title ?? r.url,
      url: r.url,
      snippet: (Array.isArray(r.highlights) && r.highlights.length ? r.highlights.join(" ... ") : String(r.text ?? r.summary ?? "")).slice(0, 600),
    }));
  }

  if (s.provider === "brave") {
    if (!s.braveKey) throw new Error("BRAVE_API_KEY is not set");
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${max}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": s.braveKey },
      signal: timeout,
    });
    if (!res.ok) throw new Error(`Brave HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data: any = await res.json();
    return (data.web?.results ?? []).map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: String(r.description ?? "").replace(/<[^>]+>/g, ""),
    }));
  }

  // SearXNG (self-hosted)
  const url = `${s.searxngUrl}/search?q=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: timeout });
  if (!res.ok) throw new Error(`SearXNG HTTP ${res.status} (is format=json enabled?)`);
  const data: any = await res.json();
  return (data.results ?? [])
    .slice(0, max)
    .map((r: any) => ({ title: r.title, url: r.url, snippet: r.content ?? "" }));
}

/** Format Reddit's JSON thread into post + top comments by votes. */
export function formatRedditThread(data: any): string {
  const post = data?.[0]?.data?.children?.[0]?.data;
  if (!post) throw new Error("unexpected Reddit JSON shape");
  const comments: { body: string; score: number; reply: boolean }[] = [];
  const walk = (children: any[] | undefined, depth: number) => {
    for (const c of children ?? []) {
      if (c?.kind !== "t1" || !c.data?.body) continue;
      comments.push({ body: c.data.body, score: c.data.score ?? 0, reply: depth > 0 });
      if (depth < 1) walk(c.data.replies?.data?.children, depth + 1);
    }
  };
  walk(data?.[1]?.data?.children, 0);
  comments.sort((a, b) => b.score - a.score);

  return [
    `REDDIT THREAD r/${post.subreddit} (post score ${post.score}, ${post.num_comments ?? "?"} comments)`,
    `TITLE: ${post.title}`,
    post.selftext ? `POST: ${String(post.selftext).slice(0, 2000)}` : "",
    "",
    "TOP COMMENTS (highest votes first):",
    ...comments
      .slice(0, 30)
      .map((c) => `[${c.score} pts${c.reply ? ", reply" : ""}] ${c.body.replace(/\s+/g, " ").slice(0, 700)}`),
  ]
    .filter((line, i) => line !== "" || i === 3)
    .join("\n");
}

async function fetchRedditThread(u: URL): Promise<string> {
  const jsonUrl = `https://www.reddit.com${u.pathname.replace(/\/$/, "")}.json?limit=100&sort=top&raw_json=1`;
  const res = await fetch(jsonUrl, { headers: { "User-Agent": UA }, signal: requestSignal(25_000) });
  if (!res.ok) throw new Error(`Reddit HTTP ${res.status}`);
  return formatRedditThread(await res.json());
}

// Cache pages for the whole run so repeated fetches cost nothing. The same
// cache is what quotes are checked against (see verifyQuote).
const pageCache = new Map<string, string>();
// Search snippets seen, per URL. Prices and measurements may be quoted from
// these (retailer pages often block fetching); findings need the full page.
const snippetCache = new Map<string, string>();

/** URLs differ in trailing slashes, fragments and tracking params; compare them loosely. */
function urlKey(url: string): string {
  try {
    const u = new URL(url);
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|ref|fbclid|gclid)/i.test(p)) u.searchParams.delete(p);
    return `${u.hostname.replace(/^(www|old|m)\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

const normText = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^a-z0-9.,%₹$€£'+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Test/demo hook: make a page's text known without fetching it. */
export function rememberPage(url: string, text: string) {
  pageCache.set(urlKey(url), text);
}

/**
 * Does the quote really appear on the page (or, if allowed, in a search snippet
 * for that URL)? Tolerant of whitespace, punctuation and case; requires most of
 * the quote's words to appear in order, so a paraphrase or invented detail fails.
 */
export function verifyQuote(url: string, quote: string, opts: { allowSnippet?: boolean } = {}): "ok" | "not-fetched" | "not-found" {
  const key = urlKey(url);
  const sources = [pageCache.get(key), opts.allowSnippet ? snippetCache.get(key) : undefined].filter((x): x is string => !!x);
  if (!sources.length) return "not-fetched";
  const q = normText(quote);
  if (q.length < 8) return "not-found";
  for (const src of sources) {
    const text = normText(src);
    if (text.includes(q)) return "ok";
    // Allow small differences: ≥85% of the quote's words found in order within a window.
    const bare = (w: string) => w.replace(/[.,']+$/, "");
    const words = q.split(" ").map(bare);
    const hay = text.split(" ").map(bare);
    for (let start = hay.indexOf(words[0]); start !== -1 && start < hay.length; start = hay.indexOf(words[0], start + 1)) {
      let hit = 0;
      let j = start;
      for (const w of words) {
        const k = hay.indexOf(w, j);
        if (k !== -1 && k - j < 6) {
          hit++;
          j = k + 1;
        }
      }
      if (hit / words.length >= 0.85) return "ok";
    }
  }
  return "not-found";
}

// URLs the agent tried to open, whether or not the site allowed it.
const attempted = new Set<string>();
/** Has this URL been opened (or at least tried)? Used to make sure links the person gave were looked at. */
export const wasAttempted = (url: string) => attempted.has(urlKey(url)) || pageCache.has(urlKey(url));

async function fetchPage(url: string): Promise<string> {
  attempted.add(urlKey(url));
  const cached = pageCache.get(urlKey(url));
  if (cached) return cached;

  let u = new URL(url);
  let text: string | undefined;

  if (/(^|\.)reddit\.com$/.test(u.hostname) && u.pathname.includes("/comments/")) {
    try {
      text = await fetchRedditThread(u);
    } catch {
      u = new URL(u.toString());
      u.hostname = "old.reddit.com"; // fall back to the lighter HTML version
    }
  }

  if (text === undefined) {
    const res = await fetch(u, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
      redirect: "follow",
      signal: requestSignal(25_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url} (site may block bots; try another source)`);
    const type = res.headers.get("content-type") ?? "";
    if (!/html|text|json/.test(type)) throw new Error(`unsupported content type "${type}"`);
    const body = await res.text();
    text = type.includes("html") ? htmlToText(body) : body;
  }

  pageCache.set(urlKey(url), text);
  return text;
}

/**
 * The parts of a long page worth showing the model: passages that mention the
 * product or what it's looking for, kept in page order, plus the page's opening
 * (title, model name). Sending only these instead of whole pages is the biggest
 * cost saving in research: every later model call resends earlier tool output.
 * Quotes are still checked against the FULL page, so nothing is lost for verification.
 */
export function focusText(text: string, terms: string[], maxChars: number): string {
  if (text.length <= maxChars) return text;
  const words = [...new Set(terms.flatMap((t) => t.toLowerCase().split(/[^a-z0-9₹$%.]+/)).filter((w) => w.length >= 3))];
  if (!words.length) return `${text.slice(0, maxChars)}\n[...truncated]`;
  // Passages of ~400 chars, split on blank lines / sentence ends.
  const parts: string[] = [];
  for (const block of text.split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z])/)) {
    for (let i = 0; i < block.length; i += 400) parts.push(block.slice(i, i + 400));
  }
  const scored = parts.map((p, i) => {
    const low = p.toLowerCase();
    const hits = words.reduce((n, w) => n + (low.includes(w) ? 1 : 0), 0);
    const numbers = /\d/.test(p) ? 0.5 : 0; // measurements and prices are worth keeping
    return { i, p, score: hits + (hits ? numbers : 0) };
  });
  const head = text.slice(0, 300);
  let budget = maxChars - head.length - 80;
  const keep = new Set<number>();
  for (const s of [...scored].filter((s) => s.score > 0).sort((a, b) => b.score - a.score)) {
    if (s.p.length > budget) continue;
    keep.add(s.i);
    budget -= s.p.length + 6;
  }
  const picked = scored.filter((s) => keep.has(s.i) && s.p !== head).map((s) => s.p.trim());
  return `${head}\n[...]\n${picked.join("\n[...]\n")}\n[showing the ${picked.length} most relevant passages of a ${text.length}-character page; call fetch_page again with a different looking_for to see other parts]`;
}

/**
 * Fresh set of web tools with their own fetch budget. With focus terms (the
 * product name, the criteria), long pages are cut down to the relevant passages.
 */
export function makeWebTools(maxFetches = config.limits.maxFetchesPerTask, opts: { focus?: string[]; maxChars?: number } = {}): Tool[] {
  let fetches = 0;
  const maxChars = opts.maxChars ?? config.limits.pageChars;

  const webSearch = tool(
    "web_search",
    "Search the web. Returns titles, URLs and snippets. Snippets are NOT evidence: open pages with fetch_page. " +
      "Tips: add 'reddit' for owner discussions, add 'review' or 'long term review' for testers, " +
      "add the current year for recent models, add the user's country for price and availability.",
    { query: { type: "string" } },
    async ({ query }) => {
      const results = await search(String(query));
      for (const r of results) snippetCache.set(urlKey(r.url), `${r.title}\n${r.snippet}`);
      if (!results.length) return "No results. Try different wording.";
      return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet.slice(0, 300)}`).join("\n");
    },
  );

  const fetchPageTool = tool(
    "fetch_page",
    opts.focus
      ? "Open a URL and read the parts relevant to what you're looking for (long pages are cut to the most relevant passages). Reddit thread URLs return the post plus top-voted comments."
      : "Open a URL and read its text. Reddit thread URLs return the post plus top-voted comments.",
    opts.focus
      ? { url: { type: "string" }, looking_for: { type: "string", description: "What you want from this page, e.g. 'battery life hours, price'. Shapes which passages you see." } }
      : { url: { type: "string" } },
    async ({ url, looking_for }) => {
      // Re-reading a page already fetched (e.g. for other passages) is free.
      const cached = pageCache.has(urlKey(String(url)));
      if (!cached && fetches >= maxFetches) {
        return `ERROR: page budget for this task is used up (${maxFetches} pages). Record what you have and finish.`;
      }
      if (!cached) fetches++;
      const text = await fetchPage(String(url));
      const left = `[page ${fetches}/${maxFetches} of budget used]`;
      if (opts.focus) return `${focusText(text, [...opts.focus, String(looking_for ?? "")], maxChars)}\n${left}`;
      return text.length > maxChars
        ? `${text.slice(0, maxChars)}\n[...truncated, ${text.length - maxChars} more chars] ${left}`
        : `${text}\n${left}`;
    },
    ["url"],
  );

  return [webSearch, fetchPageTool];
}
