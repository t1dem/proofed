import { Keyboard, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NOTHING_CHECKED } from "../../../src/runfile";
import type { PullView } from "../worker/runs";
import { ago, plural, prefetch, type Ask, type Load, type Route, type useAsk } from "./lib";
import { focus, iconButton, kindOf, Link, Mark, outline, PageTitle, Pips, sha7, solid } from "./ui";

type AskedOf = ReturnType<typeof useAsk>[0];

const isFixing = (pull: PullView) => pull.state === "fixing";
const isRunning = (pull: PullView) => pull.state === "running";
export const needsYou = (pull: PullView) => !isFixing(pull) && !isRunning(pull) && kindOf(pull) !== "passed";

const sections = [
  { title: "Needs you", has: needsYou },
  { title: "Kane is checking", has: isRunning },
  { title: "Claude is fixing", has: isFixing },
  { title: "Passed", has: (pull: PullView) => kindOf(pull) === "passed" },
];

const names = (scenarios: PullView["scenarios"]) => scenarios.map((s) => s.name).join(", ");

// The second line of a row: what happened, in the words of the run.
function Why({ pull }: { pull: PullView }): ReactNode {
  const { scenarios, fix } = pull;
  const failed = scenarios.filter((s) => s.outcome === "failed");
  const unsure = scenarios.filter((s) => s.outcome === "unsure");
  const kind = kindOf(pull);
  const strong = (text: string) => <span className="font-medium text-fg">{text}</span>;

  if (kind === "running") return scenarios.length === 0 ? "Kane is checking this pull request." : "Kane is checking this pull request again.";
  if (scenarios.length === 0) return pull.headline;
  if (kind === "fixing") return <>Claude is fixing {strong(names(failed) || "this pull request")}. Kane checks again before anything is pushed.</>;
  if (kind === "failed") {
    if (failed.length === 1 && failed[0]) {
      return (
        <>
          {strong(failed[0].name)} broke{failed[0].reason ? `: ${failed[0].reason}` : "."}
        </>
      );
    }
    return (
      <>
        {strong(`${failed.length} of ${scenarios.length} broke`)}: {names(failed)}
      </>
    );
  }
  if (kind === "unsure") {
    // Kane called these passed without asserting anything, which is different from doubting the test.
    if (unsure.every((s) => s.reason === NOTHING_CHECKED)) return <>{strong(names(unsure))}: not checked. {NOTHING_CHECKED}</>;
    return (
      <>
        {strong(names(unsure))}: the test may be wrong, not the code. {unsure[0]?.reason}
      </>
    );
  }
  if (kind === "error") return pull.headline;
  const passes = `${plural(scenarios.length, "scenario")} pass${scenarios.length === 1 ? "es" : ""}`;
  if (fix?.status === "fixed") {
    return (
      <>
        Fixed by Claude{fix.commit && <> in <span className="font-mono text-[13px]">{sha7(fix.commit)}</span></>} after {plural(fix.attempts, "attempt")} · {passes}
      </>
    );
  }
  return passes;
}

function Action({ pull, asked, ask }: { pull: PullView; asked: AskedOf; ask: Ask }) {
  const kind = kindOf(pull);
  const state = asked(pull);
  if (pull.paused || (kind !== "failed" && kind !== "error")) return null;
  if (typeof state === "object") return <span className="text-[13px] text-bad" title={state.error}>Couldn't ask</span>;
  const gaveUp = pull.fix?.status === "gave-up";
  const fix = kind === "failed" && !gaveUp;
  return (
    <button
      type="button"
      className={fix ? solid : outline}
      disabled={state === "sending"}
      title={`Comments /proofed${fix ? " fix" : ""} on the pull request as you`}
      onClick={() => ask(pull, fix ? "fix" : "rerun")}
    >
      {fix ? "Fix with Claude" : "Run again"}
    </button>
  );
}

type RowProps = { pull: PullView; selected: boolean; go: (route: Route) => void; asked: AskedOf; ask: Ask; showRepo: boolean };

function Row({ pull, selected, go, asked, ask, showRepo }: RowProps) {
  const ref = useRef<HTMLLIElement>(null);
  const detail = `/api/pulls/${pull.repo}/${pull.pr}`;
  useEffect(() => {
    if (!selected) return;
    ref.current?.scrollIntoView({ block: "nearest" });
    prefetch(detail);
  }, [selected, detail]);
  // The action waits in its own column: shown on the keyboard's row and under the mouse, so the
  // column doesn't jump from row to row. Once asked, the answer stays in view.
  const shown = selected || !!asked(pull) ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100";
  return (
    <li
      ref={ref}
      onPointerEnter={() => prefetch(detail)}
      className={`group relative grid grid-cols-[16px_minmax(0,1fr)_auto] gap-x-3 rounded-lg px-3 py-2.5 transition-colors lg:grid-cols-[16px_minmax(0,1fr)_auto_136px_44px] lg:items-center ${selected ? "lg:bg-hover" : "hover:bg-hover/50"}`}
    >
      <span className="pt-0.5 lg:pt-0">
        <Mark kind={kindOf(pull)} />
      </span>
      <span className="min-w-0">
        {/* The link's ::after covers the row, so the whole row opens the pull request. */}
        <Link to={{ page: "pull", repo: pull.repo, pr: pull.pr }} go={go} className="line-clamp-2 font-medium after:absolute after:inset-0 after:rounded-lg lg:line-clamp-1">
          {pull.title ?? pull.headline} <span className="font-normal text-faint">#{pull.pr}</span>
        </Link>
        <span className="mt-0.5 line-clamp-2 text-[13px] text-dim lg:line-clamp-1">
          {showRepo && <span className="text-faint">{pull.repo.split("/")[1]} · </span>}
          <Why pull={pull} />
        </span>
        {/* No hover on a phone: the action sits under the text there. */}
        <span className="relative z-10 mt-2 flex empty:hidden lg:hidden">
          <Action pull={pull} asked={asked} ask={ask} />
        </span>
      </span>
      <span className="hidden lg:block">
        <Pips scenarios={pull.scenarios} />
      </span>
      <span className={`relative z-10 hidden justify-self-end transition-opacity lg:block ${shown}`}>
        <Action pull={pull} asked={asked} ask={ask} />
      </span>
      <span className="whitespace-nowrap pt-0.5 text-right text-[13px] tabular-nums text-faint lg:pt-0">{ago(pull.updatedAt)}</span>
    </li>
  );
}

const typing = (target: EventTarget | null) => target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);

const KEYS = [
  ["J", "Next"],
  ["K", "Previous"],
  ["↵", "Open"],
  ["F", "Fix with Claude"],
  ["R", "Run again"],
  ["?", "These keys"],
] as const;

// The keyboard cheat sheet: behind the icon and the ? key, out of the way otherwise.
function Keys({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="relative hidden lg:block">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" className={`${iconButton} ${open ? "bg-hover text-fg" : ""}`}>
        <Keyboard size={16} />
      </button>
      {open && (
        <dl className="absolute right-0 top-full z-20 mt-1.5 grid w-56 grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 rounded-lg border border-edge bg-panel p-3 text-[13px] shadow-xl shadow-black/30">
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

type InboxProps = {
  pulls: Load<PullView[]>;
  repo: string | undefined;
  onRepo: (repo: string | undefined) => void;
  go: (route: Route) => void;
  asked: AskedOf;
  ask: Ask;
};

export function Inbox({ pulls, repo, onRepo, go, asked, ask }: InboxProps) {
  const all = pulls.status === "ok" ? pulls.data.filter((p) => !repo || p.repo === repo) : [];
  const groups = sections.map((s) => ({ title: s.title, pulls: all.filter(s.has) })).filter((g) => g.pulls.length > 0);
  const ordered = groups.flatMap((g) => g.pulls);
  const [at, setAt] = useState(0);
  const [keysOpen, setKeysOpen] = useState(false);
  const selected = ordered[Math.min(at, ordered.length - 1)];

  // Read through a ref so the listener is bound once and still sees the current list.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    const move = (by: number) => selected && setAt(Math.max(0, Math.min(ordered.length - 1, ordered.indexOf(selected) + by)));
    if (e.key === "?") setKeysOpen((open) => !open);
    else if (e.key === "Escape" && keysOpen) setKeysOpen(false);
    else if (!selected) return;
    else if (e.key === "j" || e.key === "ArrowDown") move(1);
    else if (e.key === "k" || e.key === "ArrowUp") move(-1);
    else if (e.key === "Enter") go({ page: "pull", repo: selected.repo, pr: selected.pr });
    else if (e.key === "f" && kindOf(selected) === "failed" && !selected.paused && !asked(selected)) ask(selected, "fix");
    else if (e.key === "r" && !selected.paused && !asked(selected)) ask(selected, "rerun");
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-4 py-5 sm:px-8 sm:py-7">
      <PageTitle aside={ordered.length > 0 && <Keys open={keysOpen} onToggle={() => setKeysOpen(!keysOpen)} />}>
        Inbox
        {repo && (
          <button type="button" onClick={() => onRepo(undefined)} title="Show every repository" className={`ml-2 inline-flex h-7 items-center gap-1 rounded-md px-1.5 align-middle text-[14px] font-normal text-dim hover:bg-hover hover:text-fg ${focus}`}>
            {repo.split("/")[1]}
            <X size={14} />
          </button>
        )}
      </PageTitle>

      {pulls.status === "loading" && <p className="mt-6 text-faint">Loading…</p>}
      {pulls.status === "error" && <p className="mt-6 text-bad">{pulls.message}</p>}
      {pulls.status === "ok" && ordered.length === 0 && (
        <div className="mt-8">
          <p className="font-medium">Nothing here yet.</p>
          <p className="mt-1 max-w-md text-dim">
            Pull requests show up once Proofed has checked them. Connect a repository in Settings, then open a pull request that touches a
            scenario.
          </p>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.title} className="mt-7 first-of-type:mt-6">
          <h2 className="mb-1 flex items-baseline gap-2 text-[13px] font-medium text-faint">
            {group.title} <span className="tabular-nums">{group.pulls.length}</span>
          </h2>
          <ul className="-mx-3">
            {group.pulls.map((pull) => (
              <Row key={`${pull.repo}#${pull.pr}`} pull={pull} selected={pull === selected} go={go} asked={asked} ask={ask} showRepo={!repo} />
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
