import { LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PullView } from "../worker/runs";
import { FilterMenu, NO_FILTER, type InboxFilter, type Since, type Status } from "./InboxFilterMenu";
import { Glide } from "./InboxGlide";
import { Row, type AskedOf } from "./InboxRow";
import { canAskAgain, DEMO, installed, type Ask, type Load, type Route } from "./lib";
import { bone, focus, kindOf, outline, PageTitle } from "./ui";

export { NO_FILTER, type InboxFilter };

const isFixing = (pull: PullView) => pull.state === "fixing";
const isRunning = (pull: PullView) => pull.state === "running";
export const needsYou = (pull: PullView) => !isFixing(pull) && !isRunning(pull) && kindOf(pull) !== "passed";

const isPassed = (pull: PullView) => kindOf(pull) === "passed";

const sections = [
  { title: "Needs you", has: needsYou },
  { title: "Kane is checking", has: isRunning },
  { title: "Fixing", has: isFixing },
  { title: "Passed", has: isPassed },
];

const statuses = {
  "needs-you": needsYou,
  working: (pull: PullView) => isRunning(pull) || isFixing(pull),
  passed: isPassed,
} satisfies Record<Status, (pull: PullView) => boolean>;

const HOUR = 3_600_000;
const sinceMs: Record<Since, number> = { any: Infinity, day: 24 * HOUR, week: 7 * 24 * HOUR };

// The text matches the title, the number ("12" or "#12"), the repository or a scenario's name.
function matches(pull: PullView, text: string) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = [pull.title ?? pull.headline, `#${pull.pr}`, pull.repo, ...pull.scenarios.map((s) => s.name)].join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

export const typing = (target: EventTarget | null) => target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);

function Skeleton() {
  return (
    <div className="mt-6" aria-busy="true" aria-label="Loading">
      <span className={`${bone} block h-3.5 w-20`} />
      <ul className="mt-3 space-y-5">
        {[72, 58, 64, 50].map((w, i) => (
          <li key={i} className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-3">
            <span className={`${bone} size-4 rounded-full`} />
            <span>
              <span className={`${bone} block h-4`} style={{ width: `${w}%` }} />
              <span className={`${bone} mt-2 block h-3`} style={{ width: `${w + 14}%` }} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Installed, the page doesn't bounce (index.css), so pulling the top of the list down is ours: past
// 72px and let go, the inbox is read again, the spinner turning until the answer is in.
function usePullToRefresh(refresh: () => Promise<unknown>) {
  const [pulled, setPulled] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyNow = useRef(false);
  useEffect(() => {
    if (!installed()) return;
    let y0: number | undefined;
    let dy = 0;
    const down = (e: TouchEvent) => {
      y0 = scrollY <= 0 && !busyNow.current ? e.touches[0]!.clientY : undefined;
      dy = 0;
    };
    const move = (e: TouchEvent) => {
      if (y0 === undefined) return;
      dy = Math.max(0, e.touches[0]!.clientY - y0);
      setPulled(dy / 72);
    };
    const up = async () => {
      if (y0 === undefined) return;
      y0 = undefined;
      if (dy < 72) return setPulled(0);
      busyNow.current = true;
      setBusy(true);
      try {
        await refresh();
      } finally {
        busyNow.current = false;
        setBusy(false);
        setPulled(0);
      }
    };
    addEventListener("touchstart", down, { passive: true });
    addEventListener("touchmove", move, { passive: true });
    addEventListener("touchend", up);
    return () => {
      removeEventListener("touchstart", down);
      removeEventListener("touchmove", move);
      removeEventListener("touchend", up);
    };
  }, [refresh]);
  if (!busy && pulled === 0) return null;
  const at = busy ? 1 : Math.min(pulled, 1.4);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-(--bar) z-20 flex justify-center md:hidden" style={{ transform: `translateY(${at * 28}px)`, opacity: Math.min(at, 1) }}>
      <span className="grid size-9 place-items-center rounded-full border border-edge bg-panel shadow-lg shadow-black/30">
        <LoaderCircle size={18} className={busy ? "animate-spin text-fg" : "text-dim"} style={busy ? undefined : { transform: `rotate(${at * 270}deg)` }} />
      </span>
    </div>
  );
}

type InboxProps = {
  pulls: Load<PullView[]>;
  onRefresh: () => Promise<unknown>;
  repo: string | undefined;
  onRepo: (repo: string | undefined) => void;
  filter: InboxFilter;
  onFilter: (filter: InboxFilter) => void;
  go: (route: Route) => void;
  asked: AskedOf;
  ask: Ask;
};

export function Inbox({ pulls, onRefresh, repo, onRepo, filter, onFilter, go, asked, ask }: InboxProps) {
  const inRepo = pulls.status === "ok" ? pulls.data.filter((p) => !repo || p.repo === repo) : [];
  const repos = pulls.status === "ok" ? [...new Set(pulls.data.map((p) => p.repo))].sort() : [];
  const now = Date.now();
  const all = inRepo.filter(
    (p) =>
      (filter.statuses.length === 0 || filter.statuses.some((s) => statuses[s](p))) &&
      (filter.fixes.length === 0 || (!!p.fix && filter.fixes.includes(p.fix.status))) &&
      now - p.updatedAt <= sinceMs[filter.since] &&
      matches(p, filter.text),
  );
  const groups = sections.map((s) => ({ title: s.title, pulls: all.filter(s.has) })).filter((g) => g.pulls.length > 0);
  const ordered = groups.flatMap((g) => g.pulls);
  const [at, setAt] = useState(0);
  const selected = ordered[Math.min(at, ordered.length - 1)];
  const [filterOpen, setFilterOpen] = useState(false);
  const refreshing = usePullToRefresh(onRefresh);
  const narrow = (next: Partial<InboxFilter>) => {
    onFilter({ ...filter, ...next });
    setAt(0);
  };

  // Read through a ref so the listener is bound once and still sees the current list.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    if (e.key === "Enter" && e.target instanceof HTMLElement && e.target.closest("button")) return;
    const move = (by: number) => selected && setAt(Math.max(0, Math.min(ordered.length - 1, ordered.indexOf(selected) + by)));
    if (e.key === "/") setFilterOpen(true);
    else if (!selected) return;
    else if (e.key === "j" || e.key === "ArrowDown") move(1);
    else if (e.key === "k" || e.key === "ArrowUp") move(-1);
    else if (e.key === "Enter") go({ page: "pull", repo: selected.repo, pr: selected.pr });
    else if (e.key === "f" && kindOf(selected) === "failed" && !selected.paused && !selected.readOnly && canAskAgain(asked(selected))) ask(selected, "fix");
    else if (e.key === "r" && !selected.paused && !selected.readOnly && canAskAgain(asked(selected))) ask(selected, "rerun");
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-8 sm:px-8 md:py-7">
      <PageTitle
        aside={
          <>
            {inRepo.length > 0 && (
              <FilterMenu filter={filter} onFilter={narrow} open={filterOpen} onOpen={setFilterOpen} repos={repos} repo={repo} onRepo={onRepo} />
            )}
          </>
        }
      >
        Inbox
        {repo && (
          <button type="button" onClick={() => onRepo(undefined)} title="Show every repository" className={`ml-2 inline-flex h-7 items-center gap-1 rounded-md px-1.5 align-middle text-[14px] font-normal text-dim hover:bg-hover hover:text-fg ${focus}`}>
            {repo.split("/")[1]}
            <X size={14} />
          </button>
        )}
      </PageTitle>

      {refreshing}
      {pulls.status === "loading" && <Skeleton />}
      {pulls.status === "error" && <p className="mt-6 text-bad">{pulls.message}</p>}
      {pulls.status === "ok" && inRepo.length > 0 && ordered.length === 0 && (
        <div className="mt-8">
          <p className="font-medium">No pull requests match.</p>
          <button type="button" onClick={() => narrow(NO_FILTER)} className={`${outline} mt-3`}>
            Clear filters
          </button>
        </div>
      )}

      {pulls.status === "ok" && inRepo.length === 0 && (
        <div className="mt-8">
          <p className="font-medium">Nothing here yet.</p>
          <p className="mt-1 max-w-md text-dim">
            Pull requests show up once Proofed has checked them. Connect a repository in Settings, then open a pull request that touches a
            scenario.
          </p>
        </div>
      )}

      <Glide>
        {groups.map((group) => (
          <section key={group.title} className="mt-7 first-of-type:mt-6 max-md:mt-0 max-md:first-of-type:mt-0">
            {/* On a phone the group's name stays under the top bar while its rows scroll. */}
            <h2
              data-glide={group.title}
              className="mb-1 flex items-baseline gap-2 text-[13px] font-medium text-faint max-md:sticky max-md:top-(--bar) max-md:z-20 max-md:-mx-4 max-md:mb-0 max-md:border-b max-md:border-edge max-md:bg-bg max-md:px-4 max-md:pb-2 max-md:pt-5"
            >
              {group.title} <span className="tabular-nums">{group.pulls.length}</span>
            </h2>
            <ul className="-mx-3 max-md:-mx-4 max-md:divide-y max-md:divide-edge">
              {group.pulls.map((pull) => (
                <Row key={`${pull.repo}#${pull.pr}`} pull={pull} selected={pull === selected} go={go} asked={asked} ask={ask} showRepo={!repo} />
              ))}
            </ul>
          </section>
        ))}
      </Glide>
    </main>
  );
}
