import { Inbox as InboxIcon, Keyboard, LogOut, Moon, Settings as SettingsIcon, Sun } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MeView } from "../worker/api";
import type { PullState, PullView } from "../worker/runs";
import { Inbox, needsYou, NO_FILTER, typing, type InboxFilter } from "./Inbox";
import { DEMO, installed, prefetch, useAsk, useLoad, useRoute, type Ask, type Route } from "./lib";
import { Palette } from "./Palette";
import { Pull } from "./Pull";
import { Settings } from "./Settings";
import { Avatar, focus, iconButton, kindOf, Link, marks, soft, solid, useDismiss, type Kind } from "./ui";

export type Theme = "dark" | "light";
const THEME_KEY = "proofed-theme";

export const storedTheme = (): Theme => (localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark");

function useTheme() {
  const [theme, setTheme] = useState(storedTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // The browser's bar and the installed app's status bar take the page's own background.
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#121110" : "#f4f1ea");
    if (!DEMO) localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  return [theme, () => setTheme(theme === "dark" ? "light" : "dark")] as const;
}

function SignIn() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <p className="font-serif text-2xl">Proofed</p>
      <h1 className="mt-8 text-xl font-semibold">Sign in</h1>
      <p className="mt-2 text-dim">With your GitHub account. Proofed only sees the repositories you install it on.</p>
      <a href="/login" className={`${solid} mt-6 h-10 self-start px-4`}>
        Sign in with GitHub
      </a>
    </main>
  );
}

// The worst thing happening in a repo decides the colour of its dot.
const rank: Kind[] = ["failed", "error", "unsure", "running", "fixing", "passed"];
const dotSays: Partial<Record<Kind, string>> = {
  failed: "a scenario broke",
  error: "Kane couldn't finish a run",
  unsure: "a scenario wasn't confirmed",
  running: "Kane is checking",
  fixing: "Claude is fixing",
  passed: "everything passes",
};

function repoDots(pulls: PullView[]) {
  const worst = new Map<string, Kind>();
  for (const pull of pulls) {
    const kind = kindOf(pull);
    const before = worst.get(pull.repo);
    if (!before || rank.indexOf(kind) < rank.indexOf(before)) worst.set(pull.repo, kind);
  }
  return [...worst].sort(([a], [b]) => a.localeCompare(b));
}

const navItem = `flex h-8 items-center gap-2.5 rounded-md px-2 text-dim ${soft} hover:bg-hover/60 hover:text-fg ${focus}`;
const navOn = "bg-hover text-fg hover:bg-hover";

// Who's signed in, and the way out. Opens upwards from the bottom of the sidebar. (On a phone, Settings has it.)
function Account({ me }: { me: MeView }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, useCallback(() => setOpen(false), []), box);
  return (
    <div ref={box} className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Account: ${me.login}`}
        onClick={() => setOpen(!open)}
        className={`flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left hover:bg-hover ${focus}`}
      >
        <Avatar me={me} />
        <span className="truncate">{me.login}</span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-1.5 w-52 rounded-lg border border-edge bg-panel p-1 shadow-xl shadow-black/30">
          {/* The demo's account is made up; signing out from it would sign out whoever is really signed in. */}
          <p className="truncate px-2 py-1.5 text-[13px] text-faint">{DEMO ? "Demo on sample data" : `Signed in as ${me.login}`}</p>
          <a href={DEMO ? "/app" : "/logout"} className={`${navItem} w-full`}>
            <LogOut size={16} />
            {DEMO ? "Leave the demo" : "Sign out"}
          </a>
        </div>
      )}
    </div>
  );
}

const KEYS = [
  ["J", "Next"],
  ["K", "Previous"],
  ["↵", "Open"],
  ["F", "Fix with Claude"],
  ["R", "Run again"],
  ["/", "Filter"],
  ["⌘K", "Go to…"],
  ["?", "These keys"],
] as const;

// The keyboard cheat sheet, with the theme and Settings at the foot of the sidebar: it's about the
// whole app, not one page. Opens upward from its icon, or with the ? key anywhere.
function Keys() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, useCallback(() => setOpen(false), []), box);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !typing(e.target)) setOpen((o) => !o);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  return (
    <div ref={box}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        className={`${iconButton} ${open ? "bg-hover text-fg" : ""}`}
      >
        <Keyboard size={16} />
      </button>
      {open && (
        <dl className="absolute inset-x-0 bottom-full z-20 mb-1.5 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 rounded-lg border border-edge bg-panel p-3 text-[13px] shadow-xl shadow-black/30">
          {KEYS.map(([key, does]) => (
            <div key={key} className="contents">
              <dt>
                <kbd className="inline-grid min-w-6 place-items-center rounded border border-edge bg-bg px-1.5 py-px font-mono text-[12px]">{key}</kbd>
              </dt>
              <dd className="text-dim">{does}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

type SidebarProps = {
  me: MeView;
  route: Route;
  go: (route: Route) => void;
  pulls: PullView[];
  repo: string | undefined;
  onRepo: (repo: string | undefined) => void;
  theme: Theme;
  onTheme: () => void;
};

function Sidebar({ me, route, go, pulls, repo, onRepo, theme, onTheme }: SidebarProps) {
  const waiting = pulls.filter(needsYou).length;
  const repos = repoDots(pulls);
  const inSettings = route.page === "settings";
  const pickRepo = (name: string | undefined) => {
    onRepo(name);
    if (route.page !== "inbox") go({ page: "inbox" });
  };
  const ThemeIcon = theme === "dark" ? Sun : Moon;
  const themeLabel = theme === "dark" ? "Light theme" : "Dark theme";
  const inboxOn = !inSettings && !repo;

  // A phone has the TabBar instead.
  return (
    <aside className="sticky top-0 z-10 hidden h-dvh w-60 shrink-0 flex-col border-r border-edge bg-side px-3 py-4 md:flex">
      <a href="/" className={`mb-5 self-start rounded-md px-2 font-serif text-xl ${focus}`}>
        Proofed
      </a>
      <nav>
        {/* Inbox is every repository: it also clears the repository filter. */}
        <Link
          to={{ page: "inbox" }}
          go={(to) => {
            onRepo(undefined);
            go(to);
          }}
          className={`${navItem} ${inboxOn ? navOn : ""}`}
        >
          <InboxIcon size={16} className="shrink-0" />
          <span className="flex-1">Inbox</span>
          {waiting > 0 && <span className="font-medium tabular-nums text-bad">{waiting}</span>}
        </Link>
      </nav>

      {repos.length > 1 && (
        <nav aria-label="Repositories" className="mt-6 flex flex-col gap-0.5">
          <p className="px-2 pb-1.5 text-[12px] font-medium text-faint">Repositories</p>
          {repos.map(([name, kind]) => (
            <button
              key={name}
              type="button"
              onClick={() => pickRepo(repo === name ? undefined : name)}
              title={`${name}: ${dotSays[kind] ?? ""}`}
              aria-pressed={!inSettings && repo === name}
              className={`${navItem} ${!inSettings && repo === name ? navOn : ""}`}
            >
              <span className={`size-2 shrink-0 rounded-full ${marks[kind].fill}`} />
              <span className="truncate">{name.split("/")[1]}</span>
            </button>
          ))}
        </nav>
      )}

      {/* `relative`: the shortcuts sheet opens above this row, as wide as it. */}
      <div className="relative mt-auto flex items-center gap-0.5 border-t border-edge pt-3">
        <Account me={me} />
        <Keys />
        <button type="button" onClick={onTheme} className={iconButton} aria-label={themeLabel} title={themeLabel}>
          <ThemeIcon size={16} />
        </button>
        <Link to={{ page: "settings" }} go={go} title="Settings" className={`${iconButton} ${inSettings ? "bg-hover text-fg" : ""}`}>
          <SettingsIcon size={16} aria-label="Settings" />
        </Link>
      </div>
    </aside>
  );
}

// A phone's way around: the two places, at the bottom where a thumb is. A pull request's page has
// its own bar there instead (Pull.tsx), with what can be done to it.
// z-20: under the top bar (z-30), whose menus open as sheets over this one.
function TabBar({ route, go, waiting, onRepo }: { route: Route; go: (route: Route) => void; waiting: number; onRepo: (repo: string | undefined) => void }) {
  const tab = (on: boolean) => `flex h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium ${on ? "text-fg" : "text-faint"}`;
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 flex border-t border-edge bg-side pb-[env(safe-area-inset-bottom)] md:hidden">
      <Link
        to={{ page: "inbox" }}
        go={(to) => {
          onRepo(undefined);
          go(to);
        }}
        className={tab(route.page === "inbox")}
      >
        <span className="relative">
          <InboxIcon size={22} strokeWidth={route.page === "inbox" ? 2.25 : 1.75} />
          {waiting > 0 && (
            <span className="absolute -right-3 -top-1.5 min-w-[18px] rounded-full border-2 border-side bg-bad px-1 text-center text-[10px] font-semibold leading-[14px] text-white tabular-nums">
              {waiting}
            </span>
          )}
        </span>
        Inbox
      </Link>
      <Link to={{ page: "settings" }} go={go} className={tab(route.page === "settings")}>
        <SettingsIcon size={22} strokeWidth={route.page === "settings" ? 2.25 : 1.75} />
        Settings
      </Link>
    </nav>
  );
}

// The tab says how many pull requests wait for you, in its title and as a dot on its icon.
function useTabBadge(waiting: number) {
  useEffect(() => {
    document.title = waiting > 0 ? `(${waiting}) Proofed` : "Proofed";
    const icon = document.querySelector<HTMLLinkElement>("link[rel=icon]");
    if (!icon) return;
    if (waiting === 0) {
      icon.type = "image/svg+xml";
      icon.href = "/favicon.svg";
      return;
    }
    let live = true;
    const img = new Image();
    img.onload = () => {
      if (!live) return;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64;
      const g = canvas.getContext("2d");
      if (!g) return;
      g.drawImage(img, 0, 0, 64, 64);
      g.beginPath();
      g.arc(50, 14, 12, 0, 2 * Math.PI);
      g.fillStyle = "#f0685b";
      g.fill();
      g.lineWidth = 5;
      g.strokeStyle = "#121110";
      g.stroke();
      icon.type = "image/png";
      icon.href = canvas.toDataURL("image/png");
    };
    img.src = "/favicon.svg";
    return () => {
      live = false;
    };
  }, [waiting]);
}

// Installed, there's no browser to swipe back with: from the left edge of a pull request's page the
// page follows the finger, and past a third of the screen (or on a flick) it goes back to the inbox.
function useEdgeBack(enabled: boolean, back: () => void) {
  const page = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = page.current;
    if (!el || !enabled || !installed()) return;
    let start: { x: number; y: number; t: number } | undefined;
    let dx = 0;
    const set = (x: number, ms = 0) => {
      el.style.transition = ms ? `transform ${ms}ms cubic-bezier(0.2, 0.8, 0.2, 1)` : "none";
      el.style.transform = x ? `translateX(${x}px)` : "";
      el.style.boxShadow = x ? "-12px 0 24px rgba(0, 0, 0, 0.35)" : "";
    };
    const down = (e: TouchEvent) => {
      const t = e.touches[0]!;
      start = t.clientX < 24 ? { x: t.clientX, y: t.clientY, t: e.timeStamp } : undefined;
      dx = 0;
    };
    const move = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0]!;
      dx = Math.max(0, t.clientX - start.x);
      if (dx < Math.abs(t.clientY - start.y)) return;
      e.preventDefault();
      set(dx);
    };
    const up = (e: TouchEvent) => {
      if (!start) return;
      const flick = dx / (e.timeStamp - start.t) > 0.5 && dx > 40;
      start = undefined;
      if (dx > innerWidth / 3 || flick) {
        set(innerWidth, 200);
        setTimeout(() => {
          back();
          set(0);
        }, 200);
      } else set(0, 220);
    };
    addEventListener("touchstart", down, { passive: true });
    addEventListener("touchmove", move, { passive: false });
    addEventListener("touchend", up);
    return () => {
      removeEventListener("touchstart", down);
      removeEventListener("touchmove", move);
      removeEventListener("touchend", up);
      set(0);
    };
  }, [enabled, back]);
  return page;
}

const onTheWay = (state: PullState | undefined) => state === "running" || state === "fixing";

// A run or a fix can take minutes and the tab is usually behind another one: when one ends
// out of sight, the browser says so (once "Fix with Claude" or "Run again" has asked to).
function useDoneNotices(list: PullView[], go: (route: Route) => void) {
  const was = useRef(new Map<string, PullState>());
  useEffect(() => {
    const before = was.current;
    const key = (p: PullView) => `${p.repo}#${p.pr}`;
    was.current = new Map(list.map((p) => [key(p), p.state]));
    if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
    for (const pull of list) {
      if (!onTheWay(before.get(key(pull))) || onTheWay(pull.state)) continue;
      const kind = kindOf(pull);
      const note = new Notification(pull.title ?? `Pull request #${pull.pr}`, {
        body: `${marks[kind].label} · ${pull.repo.split("/")[1]} #${pull.pr}`,
        tag: key(pull),
        icon: "/favicon.svg",
      });
      note.onclick = () => {
        window.focus();
        go({ page: "pull", repo: pull.repo, pr: pull.pr });
        note.close();
      };
    }
  }, [list, go]);
}

const NONE: PullView[] = [];

export function App() {
  const [theme, toggleTheme] = useTheme();
  const [route, go] = useRoute();
  const [me, reloadMe] = useLoad<MeView>("/api/me");
  // Read more often while Kane or Claude is at work, so the end of a run shows within seconds.
  const [busy, setBusy] = useState(false);
  // Every few seconds then, as the inbox also says where each run is (PullView.live).
  const [pulls, reloadPulls] = useLoad<PullView[]>("/api/pulls", busy ? 3_000 : 20_000);
  const list = pulls.status === "ok" ? pulls.data : NONE;
  useEffect(() => setBusy(list.some((p) => onTheWay(p.state))), [list]);
  const [repo, setRepo] = useState<string>();
  const [filter, setFilter] = useState<InboxFilter>(NO_FILTER);
  const [asked, askNow] = useAsk(reloadPulls);
  // The click that starts a run is the moment to ask whether the browser may say when it ends.
  const ask: Ask = (pull, action, what) => {
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
    askNow(pull, action, what);
  };
  useTabBadge(list.filter(needsYou).length);
  useDoneNotices(list, go);
  // Back to where the pull request was opened from, or to the inbox when it was opened by its link.
  const back = useCallback(() => (history.length > 1 ? history.back() : go({ page: "inbox" })), [go]);
  const page = useEdgeBack(route.page === "pull" && me.status === "ok", back);

  // Coming back to the inbox, read it again: a repo paused in Settings shows right away, not on the next tick.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current && route.page === "inbox") reloadPulls();
    opened.current = true;
  }, [route.page, reloadPulls]);

  // Settings asks GitHub a lot per repo; start on it while the inbox is being read.
  const signedIn = me.status === "ok";
  useEffect(() => {
    if (signedIn) prefetch("/api/repos");
  }, [signedIn]);

  if (me.status === "loading") return null;
  if (me.status === "signed-out") return <SignIn />;
  if (me.status === "error") return <p className="p-8 text-bad">{me.message}</p>;

  return (
    <div className="md:flex">
      <Palette pulls={list} go={go} onRepo={setRepo} theme={theme} onTheme={toggleTheme} />
      <Sidebar me={me.data} route={route} go={go} pulls={list} repo={repo} onRepo={setRepo} theme={theme} onTheme={toggleTheme} />
      {/* On a phone, room at the bottom for the TabBar or the pull request's action bar. */}
      <div ref={page} className="min-w-0 flex-1 bg-bg max-md:min-h-dvh max-md:pb-[calc(64px+env(safe-area-inset-bottom))]">
        {route.page === "settings" ? (
          <Settings me={me.data} reloadMe={reloadMe} theme={theme} onTheme={toggleTheme} />
        ) : route.page === "pull" ? (
          <Pull
            key={`${route.repo}#${route.pr}`}
            repo={route.repo}
            pr={route.pr}
            scenario={route.scenario}
            listed={list.find((p) => p.repo === route.repo && p.pr === route.pr)}
            go={go}
            asked={asked}
            ask={ask}
          />
        ) : (
          <Inbox pulls={pulls} onRefresh={reloadPulls} repo={repo} onRepo={setRepo} filter={filter} onFilter={setFilter} go={go} asked={asked} ask={ask} />
        )}
      </div>
      {route.page !== "pull" && <TabBar route={route} go={go} waiting={list.filter(needsYou).length} onRepo={setRepo} />}
    </div>
  );
}
