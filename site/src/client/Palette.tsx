import { ChartColumn, Inbox as InboxIcon, Moon, PanelLeftClose, PanelLeftOpen, Search, Settings as SettingsIcon, Sun } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PullView } from "../worker/runs";
import type { Route } from "./lib";
import { Kbd, kindOf, Mark, marks, RepoChip } from "./ui";

type Item = { key: string; words: string; icon: ReactNode; label: ReactNode; hint?: string; run: () => void };

type PaletteProps = {
  pulls: PullView[];
  go: (route: Route) => void;
  onRepo: (repo: string | undefined) => void;
  theme: "dark" | "light";
  onTheme: () => void;
  sidebarHidden: boolean;
  onSidebar: () => void;
};

// Dispatched on window by the sidebar's Search button.
export const OPEN_PALETTE = "proofed:palette";

// ⌘K (Ctrl+K): type a few letters of a pull request, a repository or a page, Enter goes there.
export function Palette({ pulls, go, onRepo, theme, onTheme, sidebarHidden, onSidebar }: PaletteProps) {
  const [open, setOpen] = useState(false);
  // Closing plays the way out before the palette leaves the page.
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const close = () => {
    if (leaving) return;
    setLeaving(true);
    leaveTimer.current = setTimeout(() => {
      setOpen(false);
      setLeaving(false);
    }, 130);
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (openRef.current) closeRef.current();
        else setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    addEventListener("keydown", onKey);
    addEventListener(OPEN_PALETTE, onOpen);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener(OPEN_PALETTE, onOpen);
    };
  }, []);
  if (!open) return null;

  const repos = [...new Set(pulls.map((p) => p.repo))].sort();
  const items: Item[] = [
    ...pulls.map((pull) => ({
      key: `pull:${pull.repo}#${pull.pr}`,
      words: `${pull.title ?? pull.headline} #${pull.pr} ${pull.repo}`,
      icon: <Mark kind={kindOf(pull)} />,
      label: (
        <>
          {pull.title ?? pull.headline} <span className="text-faint">#{pull.pr}</span>
        </>
      ),
      hint: pull.repo.split("/")[1],
      run: () => go({ page: "pull", repo: pull.repo, pr: pull.pr }),
    })),
    ...repos.map((repo) => {
      const worst = pulls.filter((p) => p.repo === repo).map(kindOf);
      const kind = worst.includes("failed") ? "failed" : worst.includes("unsure") ? "unsure" : "passed";
      return {
        key: `repo:${repo}`,
        words: `${repo} repository`,
        icon: <RepoChip repo={repo} size={18} />,
        label: repo.split("/")[1],
        hint: "Repository",
        run: () => {
          onRepo(repo);
          go({ page: "inbox" });
        },
      };
    }),
    {
      key: "inbox",
      words: "inbox",
      icon: <InboxIcon size={16} className="text-dim" />,
      label: "Inbox",
      run: () => {
        onRepo(undefined);
        go({ page: "inbox" });
      },
    },
    { key: "dashboard", words: "dashboard usage credits runs stats fixes", icon: <ChartColumn size={16} className="text-dim" />, label: "Dashboard", run: () => go({ page: "dashboard" }) },
    { key: "settings", words: "settings keys repositories model", icon: <SettingsIcon size={16} className="text-dim" />, label: "Settings", run: () => go({ page: "settings" }) },
    {
      key: "theme",
      words: "theme dark light",
      icon: theme === "dark" ? <Sun size={16} className="text-dim" /> : <Moon size={16} className="text-dim" />,
      label: theme === "dark" ? "Light theme" : "Dark theme",
      run: onTheme,
    },
    {
      key: "sidebar",
      words: "sidebar hide show panel",
      icon: sidebarHidden ? <PanelLeftOpen size={16} className="text-dim" /> : <PanelLeftClose size={16} className="text-dim" />,
      label: sidebarHidden ? "Show sidebar" : "Hide sidebar",
      hint: "⌘\\",
      run: onSidebar,
    },
  ];
  return <Panel items={items} close={close} leaving={leaving} />;
}

function Panel({ items, close, leaving }: { items: Item[]; close: () => void; leaving: boolean }) {
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = items.filter((item) => words.every((w) => item.words.toLowerCase().includes(w)));
  const current = Math.min(at, found.length - 1);

  useEffect(() => {
    list.current?.children[current]?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const pick = (item: Item | undefined) => {
    if (!item) return;
    close();
    item.run();
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-4 pt-[14vh] backdrop-blur-[2px] ${leaving ? "animate-[veil-out_130ms_ease-in_forwards]" : "animate-[fade-in_180ms_ease-out]"}`}
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-label="Go to"
        className={`w-full max-w-[640px] overflow-hidden rounded-2xl border border-edge bg-panel shadow-[0_24px_80px_-12px_rgb(0_0_0/0.6),0_0_0_1px_rgb(255_255_255/0.03)] ${leaving ? "animate-[palette-out_130ms_ease-in_forwards]" : "animate-[palette-in_240ms_cubic-bezier(0.16,1,0.3,1)]"}`}
      >
        <label className="flex items-center gap-3 border-b border-edge px-5">
          <Search size={18} className="shrink-0 text-faint" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setAt(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setAt(Math.min(current + 1, found.length - 1));
              else if (e.key === "ArrowUp") setAt(Math.max(current - 1, 0));
              else if (e.key === "Enter") pick(found[current]);
              else if (e.key === "Escape") close();
              else return;
              e.preventDefault();
            }}
            placeholder="Go to a pull request, repository or page"
            aria-label="Go to"
            className="h-14 w-full bg-transparent text-[16px] outline-none placeholder:text-faint"
          />
        </label>
        <ul ref={list} className="max-h-[52vh] overflow-y-auto p-2">
          {found.length === 0 && <li className="px-3 py-6 text-center text-dim">Nothing matches “{query}”.</li>}
          {found.map((item, i) => (
            <li key={item.key}>
              <button
                type="button"
                tabIndex={-1}
                onPointerMove={() => i !== current && setAt(i)}
                onClick={() => pick(item)}
                // The row the mouse leaves fades out slowly, the new one comes in quickly (as ui.tsx soft).
                className={`flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left transition-colors ease-out ${i === current ? "bg-hover text-fg duration-150" : "text-dim duration-300"}`}
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-md bg-hover/80">{item.icon}</span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint && <span className="shrink-0 text-[12px] text-faint">{item.hint}</span>}
                {i === current && <Kbd>↵</Kbd>}
              </button>
            </li>
          ))}
        </ul>
        {/* What the keys do, as Raycast's footer: always the same three, so they're learnt once. */}
        <div className="flex items-center justify-end gap-4 border-t border-edge bg-bg/40 px-4 py-2 text-[12px] text-faint max-md:hidden">
          <span className="mr-auto flex items-center gap-2 font-medium text-dim">
            <img src="/favicon.svg" alt="" className="size-4 rounded-[4px]" />
            Proofed
          </span>
          <span className="flex items-center gap-1.5">
            Open <Kbd>↵</Kbd>
          </span>
          <span className="flex items-center gap-1.5">
            Move <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
          </span>
          <span className="flex items-center gap-1.5">
            Close <Kbd>esc</Kbd>
          </span>
        </div>
      </div>
    </div>
  );
}
