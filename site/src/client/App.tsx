import { Inbox as InboxIcon, LogOut, Moon, Settings as SettingsIcon, Sun } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MeView } from "../worker/api";
import type { PullView } from "../worker/runs";
import { Inbox, needsYou } from "./Inbox";
import { DEMO, prefetch, useAsk, useLoad, useRoute, type Route } from "./lib";
import { Pull } from "./Pull";
import { Settings } from "./Settings";
import { focus, iconButton, kindOf, Link, marks, solid, useDismiss, type Kind } from "./ui";

type Theme = "dark" | "light";
const THEME_KEY = "proofed-theme";

export const storedTheme = (): Theme => (localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark");

function useTheme() {
  const [theme, setTheme] = useState(storedTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
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

const navItem = `flex h-8 items-center gap-2.5 rounded-md px-2 text-dim transition-colors hover:bg-hover/60 hover:text-fg ${focus}`;
const navOn = "bg-hover text-fg hover:bg-hover";

function Avatar({ me }: { me: MeView }) {
  if (me.avatar) return <img src={me.avatar} alt="" className="size-6 shrink-0 rounded-full" />;
  return <span className="grid size-6 shrink-0 place-items-center rounded-full bg-hover text-[12px] font-semibold uppercase text-dim">{me.login[0]}</span>;
}

// Who's signed in, and the way out. Opens upwards from the bottom of the sidebar, downwards on a phone.
function Account({ me }: { me: MeView }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, useCallback(() => setOpen(false), []), box);
  return (
    <div ref={box} className="relative min-w-0 md:flex-1">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Account: ${me.login}`}
        onClick={() => setOpen(!open)}
        className={`flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-1 text-left hover:bg-hover md:px-1.5 ${focus}`}
      >
        <Avatar me={me} />
        <span className="hidden truncate md:inline">{me.login}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1.5 w-52 rounded-lg border border-edge bg-panel p-1 shadow-xl shadow-black/30 md:bottom-full md:left-0 md:right-auto md:top-auto md:mb-1.5 md:mt-0">
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

  return (
    <aside className="sticky top-0 z-10 flex shrink-0 items-center gap-1 border-b border-edge bg-side px-3 py-2 md:h-dvh md:w-60 md:flex-col md:items-stretch md:gap-0 md:border-b-0 md:border-r md:px-3 md:py-4">
      <a href="/" className={`mr-2 rounded-md px-1 font-serif text-xl md:mb-5 md:mr-0 md:self-start md:px-2 ${focus}`}>
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
          className={`${navItem} ${!inSettings && !repo ? navOn : ""}`}
        >
          <InboxIcon size={16} className="shrink-0" />
          <span className="md:flex-1">Inbox</span>
          {waiting > 0 && <span className="font-medium tabular-nums text-bad">{waiting}</span>}
        </Link>
      </nav>

      {repos.length > 1 && (
        <nav aria-label="Repositories" className="hidden md:mt-6 md:flex md:flex-col md:gap-0.5">
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

      <div className="ml-auto flex items-center gap-0.5 md:ml-0 md:mt-auto md:border-t md:border-edge md:pt-3">
        <Account me={me} />
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

export function App() {
  const [theme, toggleTheme] = useTheme();
  const [route, go] = useRoute();
  const [me, reloadMe] = useLoad<MeView>("/api/me");
  const [pulls, reloadPulls] = useLoad<PullView[]>("/api/pulls", 20_000);
  const [repo, setRepo] = useState<string>();
  const [asked, ask] = useAsk(reloadPulls);

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

  const list = pulls.status === "ok" ? pulls.data : [];
  return (
    <div className="md:flex">
      <Sidebar me={me.data} route={route} go={go} pulls={list} repo={repo} onRepo={setRepo} theme={theme} onTheme={toggleTheme} />
      <div className="min-w-0 flex-1">
        {route.page === "settings" ? (
          <Settings me={me.data} reloadMe={reloadMe} />
        ) : route.page === "pull" ? (
          <Pull
            key={`${route.repo}#${route.pr}`}
            repo={route.repo}
            pr={route.pr}
            listed={list.find((p) => p.repo === route.repo && p.pr === route.pr)}
            go={go}
            asked={asked}
            ask={ask}
          />
        ) : (
          <Inbox pulls={pulls} repo={repo} onRepo={setRepo} go={go} asked={asked} ask={ask} />
        )}
      </div>
    </div>
  );
}
