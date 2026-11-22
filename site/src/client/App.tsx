import { ChartColumn, Inbox as InboxIcon, LogOut, PanelLeftClose, PanelLeftOpen, Search, Settings as SettingsIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as KeyEvent, type PointerEvent as PointerDown } from "react";
import type { MeView } from "../worker/api";
import type { PullState, PullView } from "../worker/runs";
import { Dashboard } from "./Dashboard";
import { Inbox, needsYou, NO_FILTER, type InboxFilter } from "./Inbox";
import { DEMO, installed, prefetch, useAsk, useLoad, useRoute, type Ask, type Route } from "./lib";
import { OPEN_PALETTE, Palette } from "./Palette";
import { GitHubMark, Pull } from "./Pull";
import { Settings } from "./Settings";
import { SIDEBAR, SNAP, useSidebar } from "./sidebar";
import { storedTheme, storeTheme, type Theme } from "./theme";

type Rail = ReturnType<typeof useSidebar>;
import { Avatar, focus, Kbd, kindOf, Link, Logo, marks, RepoChip, soft, useDismiss, type Kind } from "./ui";

function useTheme() {
  const [theme, setTheme] = useState(storedTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // The browser's bar and the installed app's status bar take the page's own background.
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#070707" : "#f3f3f3");
    if (!DEMO) storeTheme(theme);
  }, [theme]);
  return [theme, () => setTheme(theme === "dark" ? "light" : "dark")] as const;
}

// The way in. On a wide screen the app itself sits beside it, on sample data, so what's behind the
// door is the first thing seen; it's only a picture there (inert), and isn't loaded on a phone (lazy, hidden).
function SignIn() {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex min-h-dvh bg-side">
      <main className="flex min-w-0 flex-1 flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-10 lg:max-w-[600px] lg:basis-[42%]">
        <a href="/" className={`self-start rounded-md ${focus}`}>
          <Logo size={22} className="text-[16px]" />
        </a>
        <div className="mx-auto my-auto w-full max-w-[340px] py-16">
          <h1 className="text-[28px] font-semibold leading-9 tracking-[-0.02em]">Sign in to Proofed</h1>
          <p className="mt-3 text-[15px] leading-6 text-dim">Use your GitHub account. Proofed only sees the repositories you install it on.</p>
          <a href="/login" className={`raised mt-8 flex h-11 w-full items-center justify-center gap-2.5 rounded-lg text-[15px] font-medium ${focus}`}>
            <GitHubMark />
            Continue with GitHub
          </a>
          <a href="/app?demo" className={`mt-5 inline-block rounded text-[14px] text-dim underline-offset-4 hover:text-fg hover:underline ${focus}`}>
            Or look around with sample data →
          </a>
        </div>
      </main>
      {/* Clip, not hidden: the inbox scrolls its picked row into view, and that would scroll a hidden-overflow box too. */}
      <div aria-hidden className="relative hidden flex-1 overflow-clip border-l border-edge bg-bg lg:block">
        <iframe
          src="/app?demo"
          title="Proofed on sample data"
          loading="lazy"
          tabIndex={-1}
          inert
          onLoad={() => setShown(true)}
          className={`absolute left-12 top-[12vh] h-[76vh] w-[1360px] rounded-l-xl border-y border-l border-edge shadow-2xl shadow-black/50 transition-opacity duration-700 ${shown ? "opacity-100" : "opacity-0"}`}
        />
      </div>
    </div>
  );
}

// The worst thing happening in a repo decides the colour of its dot.
const rank: Kind[] = ["failed", "error", "unsure", "running", "fixing", "passed"];
const dotSays: Partial<Record<Kind, string>> = {
  failed: "a scenario broke",
  error: "Kane couldn't finish a run",
  unsure: "a scenario wasn't confirmed",
  running: "Kane is checking",
  fixing: "Fix in progress",
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

const navItem = `flex h-8 items-center gap-2.5 rounded-lg px-2 text-dim ${soft} hover:bg-hover/70 hover:text-fg ${focus}`;
// The sidebar's foot: quiet until pointed at.
const footIcon = `inline-grid size-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-hover/70 hover:text-fg ${focus}`;
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
        className={`flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-1.5 text-left ${soft} hover:bg-hover/70 ${open ? "bg-hover/70" : ""} ${focus}`}
      >
        <Avatar me={me} />
        <span className="flex min-w-0 flex-1 items-start gap-1">
          <span className="truncate font-medium">{me.login}</span>
          {DEMO && <span className="mt-0.5 shrink-0 text-[10px] font-medium leading-none text-faint">Demo</span>}
        </span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-1.5 w-56 origin-bottom-left animate-[menu-in_170ms_cubic-bezier(0.16,1,0.3,1)] rounded-xl border border-edge bg-panel p-1 shadow-2xl shadow-black/40">
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

type SidebarProps = {
  me: MeView;
  route: Route;
  go: (route: Route) => void;
  pulls: PullView[];
  repo: string | undefined;
  onRepo: (repo: string | undefined) => void;
  rail: Rail;
};

const slide = "duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)]";

// Its right edge drags to any width between SIDEBAR.min and .max (double-click: back to the usual
// one); dragged well past the narrowest, it hides. Hidden, it slides back out over the page while
// the pointer rests on the window's left edge, and goes once the pointer leaves it.
function Sidebar({ me, route, go, pulls, repo, onRepo, rail }: SidebarProps) {
  const waiting = pulls.filter(needsYou).length;
  const repos = repoDots(pulls);
  const inSettings = route.page === "settings";
  const inDashboard = route.page === "dashboard";
  const inList = !inSettings && !inDashboard;
  const pickRepo = (name: string | undefined) => {
    onRepo(name);
    if (route.page !== "inbox") go({ page: "inbox" });
  };
  const inboxOn = inList && !repo;

  const [peek, setPeek] = useState(false);
  // Once it has peeked, it stays a floating card until shown for good, so it doesn't change shape on the way out.
  const [float, setFloat] = useState(false);
  const [dragging, setDragging] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const later = (ms: number, run: () => void) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(run, ms);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (rail.hidden) return;
    clearTimeout(timer.current);
    setPeek(false);
    setFloat(false);
  }, [rail.hidden]);
  const shown = !rail.hidden || peek;
  const floating = rail.hidden && float;

  const drag = (e: PointerDown) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = rail.width;
    const root = document.documentElement;
    setDragging(true);
    root.classList.add("resizing");
    const move = (ev: PointerEvent) => {
      const raw = w0 + ev.clientX - x0;
      if (raw >= SNAP) return rail.setWidth(raw);
      stop();
      rail.hide(w0);
    };
    const stop = () => {
      setDragging(false);
      root.classList.remove("resizing");
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", stop);
      removeEventListener("pointercancel", stop);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", stop);
    addEventListener("pointercancel", stop);
  };
  const nudge = (e: KeyEvent) => {
    const step = e.shiftKey ? 48 : 16;
    const to = { ArrowLeft: rail.width - step, ArrowRight: rail.width + step, Home: SIDEBAR.min, End: SIDEBAR.max }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    rail.setWidth(to);
  };

  // A phone has the TabBar instead.
  return (
    <>
      {/* Holds the sidebar's place beside the page, so the page slides over as it hides. */}
      <div aria-hidden className={`hidden shrink-0 md:block ${dragging ? "" : `transition-[width] ${slide}`}`} style={{ width: rail.hidden ? 0 : rail.width }} />
      {rail.hidden && !peek && <div aria-hidden className="fixed inset-y-0 left-0 z-40 hidden w-2 md:block" onMouseEnter={() => later(120, () => { setFloat(true); setPeek(true); })} onMouseLeave={() => clearTimeout(timer.current)} />}
      <aside
        inert={!shown}
        aria-label="Sidebar"
        onMouseEnter={() => peek && clearTimeout(timer.current)}
        onMouseLeave={() => peek && later(280, () => setPeek(false))}
        style={{ width: rail.width, transform: shown ? undefined : `translateX(calc(-100% - ${floating ? 16 : 0}px))` }}
        className={`@container fixed hidden flex-col bg-side px-3 py-4 transition-transform md:flex ${slide} ${floating ? "inset-y-2 left-2 rounded-xl border border-edge shadow-2xl shadow-black/40" : "inset-y-0 left-0"} ${rail.hidden ? "z-40" : "z-10"}`}
      >
        <div className="mb-5 flex items-center gap-1.5">
          <a href="/" className={`rounded-md px-2 text-[15px] ${focus}`}>
            <Logo />
          </a>
          <button
            type="button"
            onClick={rail.toggle}
            aria-label={rail.hidden ? "Keep the sidebar open" : "Hide the sidebar"}
            title={rail.hidden ? "Keep open (⌘\\)" : "Hide sidebar (⌘\\)"}
            className={`${footIcon} ml-auto size-7`}
          >
            {rail.hidden ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>
        {/* The palette, for the mouse: ⌘K does the same from anywhere. */}
        <button
          type="button"
          onClick={() => dispatchEvent(new Event(OPEN_PALETTE))}
          className={`inset mb-4 flex h-8 items-center gap-2 rounded-lg px-2 text-left text-faint hover:text-dim ${focus}`}
        >
          <Search size={15} className="shrink-0" />
          <span className="flex-1">Search</span>
          <span className="flex gap-0.5">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        <nav className="flex flex-col gap-1">
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
            {waiting > 0 && (
              <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-bad/15 px-1 text-[11px] font-semibold tabular-nums text-bad">{waiting}</span>
            )}
          </Link>
          <Link to={{ page: "dashboard" }} go={go} className={`${navItem} ${inDashboard ? navOn : ""}`}>
            <ChartColumn size={16} className="shrink-0" />
            <span className="flex-1">Dashboard</span>
          </Link>
        </nav>

        {repos.length > 1 && (
          <nav aria-label="Repositories" className="mt-6 flex min-h-0 flex-col gap-0.5 overflow-y-auto">
            <p className="px-2 pb-1.5 text-[12px] font-medium text-faint">Repositories</p>
            {repos.map(([name, kind]) => (
              <button
                key={name}
                type="button"
                onClick={() => pickRepo(repo === name ? undefined : name)}
                title={`${name}: ${dotSays[kind] ?? ""}`}
                aria-pressed={inList && repo === name}
                className={`${navItem} shrink-0 ${inList && repo === name ? navOn : ""}`}
              >
                <RepoChip repo={name} />
                <span className="min-w-0 flex-1 truncate text-left">{name.split("/")[1]}</span>
                <span className={`size-1.5 shrink-0 rounded-full ${marks[kind].fill}`} />
              </button>
            ))}
          </nav>
        )}

        {/* Who's signed in, and across from them their settings (the theme and the keys are in there too). */}
        <div className="mt-auto flex items-center gap-0.5 pt-3">
          <Account me={me} />
          <Link to={{ page: "settings" }} go={go} title="Settings" className={`${footIcon} ${inSettings ? "bg-hover text-fg" : ""}`}>
            <SettingsIcon size={15} />
            <span className="sr-only">Settings</span>
          </Link>
        </div>

        {!rail.hidden && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Sidebar width"
            aria-valuemin={SIDEBAR.min}
            aria-valuemax={SIDEBAR.max}
            aria-valuenow={rail.width}
            tabIndex={0}
            title="Drag to resize · double-click to reset"
            onPointerDown={drag}
            onDoubleClick={() => rail.setWidth(SIDEBAR.base)}
            onKeyDown={nudge}
            className="sidebar-edge absolute inset-y-0 -right-1.5 z-10 w-3 cursor-col-resize outline-none"
          />
        )}
      </aside>
    </>
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
      <Link to={{ page: "dashboard" }} go={go} className={tab(route.page === "dashboard")}>
        <ChartColumn size={22} strokeWidth={route.page === "dashboard" ? 2.25 : 1.75} />
        Dashboard
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
      g.fillStyle = "#f2625a";
      g.fill();
      g.lineWidth = 5;
      g.strokeStyle = "#111111";
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
  const rail = useSidebar();
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
  // The click that starts a run is the moment to ask whether the browser may say when it ends. Not in
  // the demo: its runs are made up, and on the landing the prompt would pop up over the page.
  const ask: Ask = (pull, action, what) => {
    if (!DEMO && "Notification" in window && Notification.permission === "default") void Notification.requestPermission();
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
      <Palette pulls={list} go={go} onRepo={setRepo} theme={theme} onTheme={toggleTheme} sidebarHidden={rail.hidden} onSidebar={rail.toggle} />
      <Sidebar me={me.data} route={route} go={go} pulls={list} repo={repo} onRepo={setRepo} rail={rail} />
      {/* On a phone, room at the bottom for the TabBar or the pull request's action bar. With the
          sidebar hidden, the page keeps a gutter on its left too, and room for the button that brings it back. */}
      <div
        ref={page}
        data-page
        className={`relative min-w-0 flex-1 bg-bg max-md:min-h-dvh max-md:pb-[calc(64px+env(safe-area-inset-bottom))] md:my-2 md:mr-2 md:min-h-[calc(100dvh-1rem)] md:rounded-xl md:border md:border-edge ${rail.hidden ? "md:ml-2 md:pl-10" : ""}`}
      >
        {/* Pinned to the window where the sidebar's hide button is (16px down, like its py-4), so it doesn't
            ride along with the page as it slides; it fades in once the sidebar has gone, under the sidebar as it comes back. */}
        <div
          inert={!rail.hidden}
          className={`fixed left-4 top-4 z-[5] transition-opacity max-md:hidden ${rail.hidden ? "opacity-100 delay-150 duration-150" : "opacity-0 duration-75"}`}
        >
          <button type="button" onClick={rail.toggle} aria-label="Show the sidebar" title="Show sidebar (⌘\\)" className={footIcon}>
            <PanelLeftOpen size={15} />
          </button>
        </div>
        {route.page === "dashboard" ? (
          <Dashboard
            onRepo={(name) => {
              setRepo(name);
              setFilter(NO_FILTER);
              go({ page: "inbox" });
            }}
            onScenario={(name, scenario) => {
              setRepo(name);
              setFilter({ ...NO_FILTER, text: scenario });
              go({ page: "inbox" });
            }}
          />
        ) : route.page === "settings" ? (
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
