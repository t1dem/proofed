import { providerLabel, providerOf } from "../worker/models";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { PullDetail, PullView } from "../worker/runs";

export const fixerName = (pull?: Pick<PullView, "fixer" | "fix" | "live">) =>
  providerLabel(providerOf(pull?.live?.fix?.model || pull?.fixer?.model || pull?.fix?.model || ""));

export const fixLabel = ({ fixer }: Pick<PullView, "fixer">) =>
  fixer ? `Fix with ${providerLabel(fixer.provider ?? providerOf(fixer.model))}` : "Fix";

export class SignedOut extends Error {}
class RequestError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean, options?: ErrorOptions) {
    super(message, options);
    this.retryable = retryable;
  }
}

// /app?demo: the app runs on sample data (demo.ts, its own chunk), in `pnpm dev` and in the built
// site alike. No sign-in, no request to the API, and nothing stored: a signed-in user's cached
// answers are neither shown nor overwritten. Links keep the query (pathOf), so the demo stays a demo.
export const DEMO = new URLSearchParams(location.search).has("demo");

// /try is open to anyone: its pages read the demo store's pull requests from the public API (worker/try.ts).
const PUBLIC = location.pathname === "/try" || location.pathname.startsWith("/try/");

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (DEMO) return (await import("./demo")).demo(path, init) as T;
  const res = await fetch(PUBLIC ? path.replace(/^\/api\/pulls\//, "/api/try/pulls/") : path, { ...init, headers: { "content-type": "application/json", ...init?.headers } }).catch((e: unknown) => {
    throw new RequestError(message(e), true, { cause: e });
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; retryable?: boolean };
  if (res.status === 401) {
    forgetAll();
    throw new SignedOut();
  }
  if (!res.ok) {
    const error = body?.error ?? `Request failed (${res.status})`;
    throw new RequestError(error, res.status >= 500 || body?.retryable === true);
  }
  return body;
}

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type Load<T> = { status: "loading" } | { status: "signed-out" } | { status: "error"; message: string } | { status: "ok"; data: T };

// Keep dashboard data in this document. Public demo responses can survive a reload.
const STORE_KEY = "proofed-public-cache:";
const memory = new Map<string, unknown>();
const watchers = new Map<string, Set<(data: unknown) => void>>();
const inFlight = new Map<string, { request: Promise<unknown>; changes: ((data: unknown) => unknown)[] }>();
const persistent = PUBLIC && !DEMO;

// Older builds cached authenticated responses without scoping them to the signed-in user.
if (!DEMO && !PUBLIC) clearStorage("proofed-cache:");

function cached<T>(path: string): T | undefined {
  if (!memory.has(path) && persistent) {
    try {
      const saved = localStorage.getItem(STORE_KEY + path);
      if (saved) memory.set(path, JSON.parse(saved));
    } catch {
      // No storage (private window, blocked): memory alone is fine.
    }
  }
  return memory.get(path) as T | undefined;
}

function store(path: string, data: unknown) {
  memory.set(path, data);
  try {
    if (persistent) localStorage.setItem(STORE_KEY + path, JSON.stringify(data));
  } catch {
    // Full or blocked storage only costs the next cold start its instant paint.
  }
  for (const watch of watchers.get(path) ?? []) watch(data);
}

function clearStorage(prefix: string) {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key);
  } catch {
    // Storage may be blocked.
  }
}

function forgetAll() {
  memory.clear();
  if (persistent) clearStorage(STORE_KEY);
}

// One request per path at a time; everyone showing that path gets the answer.
export function fetchInto<T>(path: string, { afterInFlight = false } = {}): Promise<T> {
  const running = inFlight.get(path);
  if (running) {
    if (afterInFlight) return running.request.catch(() => {}).then(() => fetchInto<T>(path));
    return running.request as Promise<T>;
  }
  const changes: ((data: unknown) => unknown)[] = [];
  const request = api<T>(path).then((data) => {
    const updated = changes.reduce<unknown>((value, change) => change(value), data) as T;
    store(path, updated);
    return updated;
  });
  inFlight.set(path, { request, changes });
  void request.finally(() => inFlight.delete(path)).catch(() => {});
  return request;
}

// Warms a page before it's opened (hover in the inbox, Settings after the inbox loads).
export const prefetch = (path: string) => {
  if (cached(path) === undefined) fetchInto(path).catch(() => {});
};

// Changes what's on screen for `path` right away, ahead of the server's answer.
export function mutate<T>(path: string, change: (data: T) => T, { preserveDuringRefresh = false } = {}) {
  // The response may reflect an earlier snapshot. Keep the changed fields if it arrives later.
  if (preserveDuringRefresh) inFlight.get(path)?.changes.push((data) => change(data as T));
  const data = cached<T>(path);
  if (data !== undefined) store(path, change(data));
}

// With `refreshMs` the data is fetched again on that interval and whenever the tab comes back,
// and what's on screen stays put until the new answer arrives.
export function useLoad<T>(path: string, refreshMs?: number) {
  const fromCache = (): Load<T> => {
    const data = cached<T>(path);
    return data === undefined ? { status: "loading" } : { status: "ok", data };
  };
  const [state, setState] = useState<Load<T>>(fromCache);
  // Resolves once the answer is in (pull to refresh waits on it).
  const reload = useCallback(
    () =>
      fetchInto<T>(path).then(
        () => {},
        (e: unknown) =>
          setState((before) =>
            e instanceof SignedOut ? { status: "signed-out" } : before.status === "ok" ? before : { status: "error", message: message(e) },
          ),
      ),
    [path],
  );

  useEffect(() => {
    setState(fromCache());
    const watch = (data: unknown) => setState({ status: "ok", data: data as T });
    const all = watchers.get(path) ?? new Set();
    watchers.set(path, all.add(watch));
    reload();
    return () => void all.delete(watch);
  }, [path, reload]);

  useEffect(() => {
    if (!refreshMs) return;
    const tick = () => document.visibilityState === "visible" && reload();
    const timer = setInterval(tick, refreshMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [reload, refreshMs]);

  return [state, reload] as const;
}

// Opened from the home screen, as an app: no browser around it, so no browser gestures either.
export const installed = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

// `scenario` (a pull request's tab, by name) rides in the hash, so the inbox's squares can open one.
export type Route = { page: "inbox" } | { page: "settings" } | { page: "pull"; repo: string; pr: number; scenario?: string };

function parseRoute({ pathname, hash }: Location): Route {
  const [, , first, second, third] = pathname.split("/");
  if (first === "settings") return { page: "settings" };
  if (first && second && third && /^\d+$/.test(third)) {
    const scenario = hash.length > 1 ? decodeURIComponent(hash.slice(1)) : undefined;
    return { page: "pull", repo: `${first}/${second}`, pr: Number(third), ...(scenario && { scenario }) };
  }
  return { page: "inbox" };
}

export const pathOf = (route: Route) =>
  (route.page === "inbox" ? "/app" : route.page === "settings" ? "/app/settings" : `/app/${route.repo}/${route.pr}`) +
  location.search +
  (route.page === "pull" && route.scenario ? `#${encodeURIComponent(route.scenario)}` : "");

// The name that pairs a pull request's title in the inbox with the one on its page.
export const titleName = (pull: { repo: string; pr: number }) => `pr-${pull.repo}-${pull.pr}`.replace(/[^\w-]/g, "-");

// Only the title that moves has a view-transition name, and only while it moves: the browser lifts every
// named element over the whole page for the length of a transition, so a name on each inbox row put them
// all over the sidebar, the bars and any open sheet. Titles carry `data-title` so the leaving one is found.
let moving: string | undefined;
export const movingName = (pull: { repo: string; pr: number }) => (titleName(pull) === moving ? moving : undefined);

// The page change as a view transition where the browser has them: `pull`'s title, on both pages,
// moves from one place to the other instead of blinking; the rest crossfades.
export function transition(change: () => void, pull?: { repo: string; pr: number }) {
  if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return change();
  moving = pull && titleName(pull);
  // The page being left is captured as it is now, before React draws the change: its title is named here.
  const leaving = moving ? document.querySelector<HTMLElement>(`[data-title="${moving}"]`) : null;
  if (leaving && moving) leaving.style.viewTransitionName = moving;
  void document.startViewTransition(() => flushSync(change)).finished.finally(() => {
    moving = undefined;
    for (const el of document.querySelectorAll<HTMLElement>("[data-title]")) el.style.viewTransitionName = "";
  });
}

const pullOf = (route: Route) => (route.page === "pull" ? route : undefined);

export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(location));
  // The page on screen, to know which pull request's title moves when leaving it.
  const shown = useRef(route);
  useEffect(() => {
    const onPop = () => {
      const next = parseRoute(location);
      const pull = pullOf(next) ?? pullOf(shown.current);
      shown.current = next;
      transition(() => setRoute(next), pull);
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((next: Route) => {
    history.pushState(null, "", pathOf(next));
    const pull = pullOf(next) ?? pullOf(shown.current);
    shown.current = next;
    transition(() => {
      setRoute(next);
      // At once: the page's smooth scrolling (index.css) would roll the new page up after it appears.
      scrollTo({ top: 0, behavior: "instant" });
    }, pull);
  }, []);
  return [route, go] as const;
}

export function ago(ts: number) {
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} d`;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type Asked = "sending" | { error: string; retryable: boolean };
export const canAskAgain = (state: Asked | undefined) => !state || (typeof state === "object" && state.retryable);
// "check": Kane checks `what`, as a "/proofed <what to check>" comment would have it.
export type Ask = (pull: { repo: string; pr: number }, action: "fix" | "rerun" | "check", what?: string) => void;

// "Fix with Claude" and "Run again": Proofed comments /proofed on the pull request for the user,
// and the workflow takes it from there. The pull request turns "running" (or "fixing") on screen at
// once; the server keeps that state until the workflow reports.
export function useAsk(reload: () => void) {
  const [asked, setAsked] = useState<Record<string, Asked | undefined>>({});
  const ask: Ask = (pull, action, what) => {
    const key = `${pull.repo}#${pull.pr}`;
    const set = (value: Asked | undefined) => setAsked((all) => ({ ...all, [key]: value }));
    const detail = `/api/pulls/${pull.repo}/${pull.pr}`;
    const state = action === "fix" ? "fixing" : "running";
    const same = (p: PullView) => p.repo === pull.repo && p.pr === pull.pr;
    mutate<PullView[]>("/api/pulls", (all) => all.map((p) => (same(p) ? { ...p, state } : p)));
    mutate<PullDetail>(detail, (d) => ({ ...d, pull: { ...d.pull, state } }));
    set("sending");
    api(`${detail}/${action}`, { method: "POST", ...(what && { body: JSON.stringify({ what }) }) }).then(
      () => set(undefined),
      (e: unknown) => set({ error: message(e), retryable: e instanceof RequestError && e.retryable }),
    ).finally(() => {
      reload();
      fetchInto(detail).catch(() => {});
    });
  };
  const stateOf = (pull: { repo: string; pr: number }) => asked[`${pull.repo}#${pull.pr}`];
  return [stateOf, ask] as const;
}
