import { Inbox as InboxIcon, Moon, Search, Settings as SettingsIcon, Sun } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PullView } from "../worker/runs";
import type { Route } from "./lib";
import { kindOf, Mark, marks } from "./ui";

type Item = { key: string; words: string; icon: ReactNode; label: ReactNode; hint?: string; run: () => void };

type PaletteProps = {
  pulls: PullView[];
  go: (route: Route) => void;
  onRepo: (repo: string | undefined) => void;
  theme: "dark" | "light";
  onTheme: () => void;
};

// ⌘K (Ctrl+K): type a few letters of a pull request, a repository or a page, Enter goes there.
export function Palette({ pulls, go, onRepo, theme, onTheme }: PaletteProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((was) => !was);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  if (!open) return null;

  const close = () => setOpen(false);
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
        icon: <span className={`mx-[3px] size-2.5 rounded-full ${marks[kind].fill}`} />,
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
    { key: "settings", words: "settings keys repositories model", icon: <SettingsIcon size={16} className="text-dim" />, label: "Settings", run: () => go({ page: "settings" }) },
    {
      key: "theme",
      words: "theme dark light",
      icon: theme === "dark" ? <Sun size={16} className="text-dim" /> : <Moon size={16} className="text-dim" />,
      label: theme === "dark" ? "Light theme" : "Dark theme",
      run: onTheme,
    },
  ];
  return <Panel items={items} close={close} />;
}

function Panel({ items, close }: { items: Item[]; close: () => void }) {
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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[14vh] transition-opacity duration-150 starting:opacity-0" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-label="Go to" className="w-full max-w-xl overflow-hidden rounded-xl border border-edge bg-panel shadow-2xl shadow-black/40 transition-[opacity,transform] duration-150 starting:scale-[0.98] starting:opacity-0">
        <label className="flex items-center gap-3 border-b border-edge px-4">
          <Search size={16} className="shrink-0 text-faint" />
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
            className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-faint"
          />
        </label>
        <ul ref={list} className="max-h-[52vh] overflow-y-auto p-1.5">
          {found.length === 0 && <li className="px-3 py-6 text-center text-dim">Nothing matches “{query}”.</li>}
          {found.map((item, i) => (
            <li key={item.key}>
              <button
                type="button"
                tabIndex={-1}
                onPointerMove={() => i !== current && setAt(i)}
                onClick={() => pick(item)}
                // The row the mouse leaves fades out slowly, the new one comes in quickly (as ui.tsx soft).
                className={`flex h-10 w-full items-center gap-3 rounded-md px-3 text-left transition-colors ease-out ${i === current ? "bg-hover text-fg duration-150" : "text-dim duration-300"}`}
              >
                <span className="grid w-4 shrink-0 place-items-center">{item.icon}</span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint && <span className="shrink-0 text-[12px] text-faint">{item.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
