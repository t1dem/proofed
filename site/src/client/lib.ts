import { useCallback, useEffect, useState } from "react";

export class SignedOut extends Error {}

// `pnpm dev` and /app?demo: the app runs on sample data, no sign-in and no GitHub.
const DEMO = import.meta.env.DEV && new URLSearchParams(location.search).has("demo");

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (DEMO) return (await import("./demo")).demo(path, init) as T;
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.status === 401) throw new SignedOut();
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type Load<T> = { status: "loading" } | { status: "signed-out" } | { status: "error"; message: string } | { status: "ok"; data: T };

// With `refreshMs` the data is fetched again on that interval and whenever the tab comes back,
// and what's on screen stays put until the new answer arrives.
export function useLoad<T>(path: string, refreshMs?: number) {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  const reload = useCallback(() => {
    api<T>(path).then(
      (data) => setState({ status: "ok", data }),
      (e: unknown) =>
        setState((before) =>
          e instanceof SignedOut ? { status: "signed-out" } : before.status === "ok" ? before : { status: "error", message: message(e) },
        ),
    );
  }, [path]);

  useEffect(() => {
    setState({ status: "loading" });
    reload();
  }, [reload]);

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

type Asked = "sending" | "sent" | { error: string };
export type Ask = (pull: { repo: string; pr: number }, action: "fix" | "rerun") => void;

// "Fix with Claude" and "Run again": Proofed comments /proofed on the pull request for the user,
// and the workflow takes it from there. The report changes a few seconds later.
export function useAsk(reload: () => void) {
  const [asked, setAsked] = useState<Record<string, Asked>>({});
  const ask: Ask = (pull, action) => {
    const key = `${pull.repo}#${pull.pr}`;
    const set = (value: Asked) => setAsked((all) => ({ ...all, [key]: value }));
    set("sending");
    api(`/api/pulls/${pull.repo}/${pull.pr}/${action}`, { method: "POST" }).then(
      () => {
        set("sent");
        setTimeout(reload, 5000);
      },
      (e: unknown) => set({ error: message(e) }),
    );
  };
  const stateOf = (pull: { repo: string; pr: number }) => asked[`${pull.repo}#${pull.pr}`];
  return [stateOf, ask] as const;
}
