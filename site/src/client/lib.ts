import { useCallback, useEffect, useState } from "react";
import type { PullDetail, PullView } from "../worker/runs";

export class SignedOut extends Error {}

// /app?demo: the app runs on sample data (demo.ts, its own chunk), in `pnpm dev` and in the built
// site alike. No sign-in, no request to the API, and nothing stored: a signed-in user's cached
// answers are neither shown nor overwritten. Links keep the query (pathOf), so the demo stays a demo.
export const DEMO = new URLSearchParams(location.search).has("demo");

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (DEMO) return (await import("./demo")).demo(path, init) as T;
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401) {
    forgetAll();
    throw new SignedOut();
  }
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type Load<T> = { status: "loading" } | { status: "signed-out" } | { status: "error"; message: string } | { status: "ok"; data: T };

// The last answer for each GET path, kept in memory and in localStorage: a page opens on what it
// showed last time and the fresh answer replaces it when it arrives, so "Loading…" shows only once.
const STORE_KEY = "proofed-cache:";
const memory = new Map<string, unknown>();
const watchers = new Map<string, Set<(data: unknown) => void>>();
const inFlight = new Map<string, Promise<unknown>>();

function cached<T>(path: string): T | undefined {
  if (!memory.has(path) && !DEMO) {
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
    if (!DEMO) localStorage.setItem(STORE_KEY + path, JSON.stringify(data));
  } catch {
    // Full or blocked storage only costs the next cold start its instant paint.
  }
  for (const watch of watchers.get(path) ?? []) watch(data);
}

function forgetAll() {
  memory.clear();
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(STORE_KEY)) localStorage.removeItem(key);
  } catch {
    // Nothing stored.
  }
}

// One request per path at a time; everyone showing that path gets the answer.
export function fetchInto<T>(path: string): Promise<T> {
  const running = inFlight.get(path);
  if (running) return running as Promise<T>;
  const request = api<T>(path).then(
    (data) => {
      store(path, data);
      return data;
    },
  );
  inFlight.set(path, request);
  void request.finally(() => inFlight.delete(path)).catch(() => {});
  return request;
}

// Warms a page before it's opened (hover in the inbox, Settings after the inbox loads).
export const prefetch = (path: string) => {
  if (cached(path) === undefined) fetchInto(path).catch(() => {});
};

// Changes what's on screen for `path` right away, ahead of the server's answer.
export function mutate<T>(path: string, change: (data: T) => T) {
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
  const reload = useCallback(() => {
    fetchInto<T>(path).catch((e: unknown) =>
      setState((before) =>
        e instanceof SignedOut ? { status: "signed-out" } : before.status === "ok" ? before : { status: "error", message: message(e) },
      ),
    );
  }, [path]);

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

export type Route = { page: "inbox" } | { page: "settings" } | { page: "pull"; repo: string; pr: number };

function parseRoute(pathname: string): Route {
  const [, , first, second, third] = pathname.split("/");
  if (first === "settings") return { page: "settings" };
  if (first && second && third && /^\d+$/.test(third)) return { page: "pull", repo: `${first}/${second}`, pr: Number(third) };
  return { page: "inbox" };
}

export const pathOf = (route: Route) =>
  (route.page === "inbox" ? "/app" : route.page === "settings" ? "/app/settings" : `/app/${route.repo}/${route.pr}`) + location.search;

export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname));
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((next: Route) => {
    history.pushState(null, "", pathOf(next));
    setRoute(next);
    scrollTo(0, 0);
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

type Asked = "sending" | { error: string };
export type Ask = (pull: { repo: string; pr: number }, action: "fix" | "rerun") => void;

// "Fix with Claude" and "Run again": Proofed comments /proofed on the pull request for the user,
// and the workflow takes it from there. The pull request turns "running" (or "fixing") on screen at
// once; the server keeps that state until the workflow reports.
export function useAsk(reload: () => void) {
  const [asked, setAsked] = useState<Record<string, Asked | undefined>>({});
  const ask: Ask = (pull, action) => {
    const key = `${pull.repo}#${pull.pr}`;
    const set = (value: Asked | undefined) => setAsked((all) => ({ ...all, [key]: value }));
    const detail = `/api/pulls/${pull.repo}/${pull.pr}`;
    const state = action === "fix" ? "fixing" : "running";
    const same = (p: PullView) => p.repo === pull.repo && p.pr === pull.pr;
    mutate<PullView[]>("/api/pulls", (all) => all.map((p) => (same(p) ? { ...p, state } : p)));
    mutate<PullDetail>(detail, (d) => ({ ...d, pull: { ...d.pull, state } }));
    set("sending");
    api(`${detail}/${action}`, { method: "POST" }).then(
      () => set(undefined),
      (e: unknown) => set({ error: message(e) }),
    ).finally(() => {
      reload();
      fetchInto(detail).catch(() => {});
    });
  };
  const stateOf = (pull: { repo: string; pr: number }) => asked[`${pull.repo}#${pull.pr}`];
  return [stateOf, ask] as const;
}
