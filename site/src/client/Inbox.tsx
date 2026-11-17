import { Check, CircleCheck, CircleDashed, CircleX, Inbox as InboxIcon, ListFilter, LoaderCircle, RotateCw, Search, Wrench, X, type LucideIcon } from "lucide-react";
import { Component, createRef, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { NOTHING_CHECKED } from "../../../src/runfile";
import type { PullView } from "../worker/runs";
import { ago, DEMO, fixerName, installed, movingName, plural, prefetch, titleName, type Ask, type Load, type Route, type useAsk } from "./lib";
import { Backdrop, bone, focus, iconButton, kindOf, Link, Mark, NEEDS_WRITE, outline, PageTitle, Pips, plain, popover, sha7, soft, solid, useDismiss, useSheetDrag } from "./ui";

type AskedOf = ReturnType<typeof useAsk>[0];

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

// What the inbox is narrowed to. Kept by the app, so it's still there coming back from a pull request.
type Status = "needs-you" | "working" | "passed";
// `statuses` empty is every status.
export type InboxFilter = { text: string; statuses: Status[] };
export const NO_FILTER: InboxFilter = { text: "", statuses: [] };

const statuses = {
  "needs-you": needsYou,
  working: (pull: PullView) => isRunning(pull) || isFixing(pull),
  passed: isPassed,
} satisfies Record<Status, (pull: PullView) => boolean>;

// The text matches the title, the number ("12" or "#12"), the repository or a scenario's name.
function matches(pull: PullView, text: string) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = [pull.title ?? pull.headline, `#${pull.pr}`, pull.repo, ...pull.scenarios.map((s) => s.name)].join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

const names = (scenarios: PullView["scenarios"]) => scenarios.map((s) => s.name).join(", ");

// The second line of a row: what happened, in the words of the run.
function Why({ pull }: { pull: PullView }): ReactNode {
  const { scenarios, fix } = pull;
  const failed = scenarios.filter((s) => s.outcome === "failed");
  const unsure = scenarios.filter((s) => s.outcome === "unsure");
  const kind = kindOf(pull);
  const strong = (text: string) => <span className="font-medium text-fg">{text}</span>;

  const live = pull.live;
  if (kind === "running") {
    const said = scenarios.length === 0 ? "Kane is checking this pull request." : "Kane is checking this pull request again.";
    // Where the run is now, once the action reports it (Live.tsx has the whole of it).
    if (!live?.scenario) return live && live.total > 0 && live.done === live.total ? `${said} Posting the report.` : said;
    return (
      <>
        {said} {live.done > 0 ? `${live.done} of ${live.total} done, on ` : "On "}
        {strong(live.scenario)}
        {live.step && `: ${plain(live.step)}`}
      </>
    );
  }
  if (scenarios.length === 0) return pull.headline;
  if (kind === "fixing") {
    const fix = live?.fix;
    const now = !fix
      ? "Kane checks again before anything is pushed."
      : fix.doing === "pushing"
        ? "Kane saw it pass; pushing the fix."
        : `Attempt ${fix.attempt} of ${fix.of}: ${fix.doing === "writing" ? "writing the change" : fix.doing === "building" ? "building it" : "Kane is checking it"}.`;
    return <>{fixerName(pull)} is fixing {strong(names(failed) || "this pull request")}. {now}</>;
  }
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
        {strong(names(unsure))}: not checked. {unsure[0]?.reason}
      </>
    );
  }
  if (kind === "error") return pull.headline;
  const passes = `${plural(scenarios.length, "scenario")} pass${scenarios.length === 1 ? "es" : ""}`;
  if (fix?.status === "fixed") {
    return (
      <>
        Fixed by {fixerName({fix})}{fix.commit && <> in <span className="font-mono text-[13px]">{sha7(fix.commit)}</span></>} after {plural(fix.attempts, "attempt")} · {passes}
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
      disabled={state === "sending" || pull.readOnly}
      title={pull.readOnly ? NEEDS_WRITE : `Comments /proofed${fix ? " fix" : ""} on the pull request as you`}
      onClick={() => ask(pull, fix ? "fix" : "rerun")}
    >
      {fix ? `Fix with ${fixerName(pull)}` : "Run again"}
    </button>
  );
}

type RowProps = { pull: PullView; selected: boolean; go: (route: Route) => void; asked: AskedOf; ask: Ask; showRepo: boolean };

// What a phone's swipe on a row offers: the same one action the desktop row has (Action).
function swipeAction(pull: PullView, asked: AskedOf) {
  const kind = kindOf(pull);
  if (pull.paused || pull.readOnly || asked(pull) || (kind !== "failed" && kind !== "error")) return undefined;
  return kind === "failed" && pull.fix?.status !== "gave-up"
    ? { does: "fix" as const, label: "Fix", icon: Wrench, tone: "bg-work text-bg" }
    : { does: "rerun" as const, label: "Run again", icon: RotateCw, tone: "bg-busy text-bg" };
}

const SWIPE = 112;

// On a phone a row slides left under the finger and uncovers its action. Only a tap on that button
// asks for it: a fix costs a run, so a swipe alone never does. A tap on the open row, or a touch
// anywhere else, slides it back.
function useSwipe(enabled: boolean) {
  const content = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const isOpen = useRef(false);
  const slide = useCallback((x: number) => {
    const el = content.current;
    if (!el) return;
    el.style.transition = "transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1)";
    el.style.transform = x ? `translateX(${x}px)` : "";
    isOpen.current = x !== 0;
    setOpen(x !== 0);
  }, []);

  useEffect(() => {
    const el = content.current;
    if (!el || !enabled) return;
    let x0 = 0;
    let y0 = 0;
    let dx = 0;
    let axis: "x" | "y" | undefined;
    const down = (e: TouchEvent) => {
      x0 = e.touches[0]!.clientX;
      y0 = e.touches[0]!.clientY;
      dx = 0;
      axis = undefined;
    };
    const move = (e: TouchEvent) => {
      dx = e.touches[0]!.clientX - x0;
      const dy = e.touches[0]!.clientY - y0;
      if (!axis && Math.hypot(dx, dy) > 8) axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axis !== "x") return;
      e.preventDefault();
      const x = (isOpen.current ? -SWIPE : 0) + dx;
      el.style.transition = "none";
      // Past the button it follows at a third of the finger's pace, so it feels held.
      el.style.transform = `translateX(${x < -SWIPE ? -SWIPE + (x + SWIPE) / 3 : Math.min(0, x)}px)`;
    };
    const up = () => {
      if (axis !== "x") return;
      slide((isOpen.current ? -SWIPE : 0) + dx < -SWIPE / 2 ? -SWIPE : 0);
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", up);
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", up);
    };
  }, [enabled, slide]);

  useEffect(() => {
    if (!open) return;
    const away = (e: TouchEvent) => !content.current?.parentElement?.contains(e.target as Node) && slide(0);
    addEventListener("touchstart", away, { passive: true });
    return () => removeEventListener("touchstart", away);
  }, [open, slide]);
  useEffect(() => {
    if (!enabled) slide(0);
  }, [enabled, slide]);

  return { content, open, close: () => slide(0) };
}

function Row({ pull, selected, go, asked, ask, showRepo }: RowProps) {
  const ref = useRef<HTMLLIElement>(null);
  const detail = `/api/pulls/${pull.repo}/${pull.pr}`;
  const swipe = swipeAction(pull, asked);
  const { content, open, close } = useSwipe(!!swipe);
  useEffect(() => {
    if (!selected) return;
    ref.current?.scrollIntoView({ block: "nearest" });
    prefetch(detail);
  }, [selected, detail]);
  // The action waits in its own column: shown on the keyboard's row and under the mouse, so the
  // column doesn't jump from row to row. Once asked, the answer stays in view.
  const shown = selected || !!asked(pull) ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100";
  return (
    <li ref={ref} data-glide={`${pull.repo}#${pull.pr}`} onPointerEnter={() => prefetch(detail)} className="relative max-md:overflow-hidden">
      {swipe && (
        <button
          type="button"
          tabIndex={open ? 0 : -1}
          aria-hidden={!open}
          onClick={() => {
            ask(pull, swipe.does);
            close();
          }}
          className={`absolute inset-y-0 right-0 flex flex-col items-center justify-center gap-1 text-[13px] font-semibold md:hidden ${swipe.tone}`}
          style={{ width: SWIPE }}
        >
          <swipe.icon size={20} />
          {swipe.label}
        </button>
      )}
      <div
        ref={content}
        onClickCapture={(e) => {
          // A tap on an open row closes it instead of opening the pull request.
          if (!open) return;
          e.preventDefault();
          e.stopPropagation();
          close();
        }}
        className={`group relative grid grid-cols-[16px_minmax(0,1fr)_auto] gap-x-3 rounded-lg px-3 py-2.5 ${soft} max-md:touch-pan-y max-md:grid-cols-[16px_minmax(0,1fr)] max-md:rounded-none max-md:bg-bg max-md:px-4 max-md:py-3 max-md:active:bg-hover lg:grid-cols-[16px_minmax(0,1fr)_auto_136px_44px] lg:items-center ${selected ? "lg:bg-hover" : "md:hover:bg-hover/50"}`}
      >
        <span className="flex h-5 items-center lg:h-auto">
          <Mark kind={kindOf(pull)} />
        </span>
        <span className="min-w-0">
          {/* The link's ::after covers the row, so the whole row opens the pull request. */}
          <Link to={{ page: "pull", repo: pull.repo, pr: pull.pr }} go={go} className="block font-medium after:absolute after:inset-0 after:rounded-lg max-md:after:rounded-none">
            {/* A block of its own: the title that moves into the pull request's page (lib.ts transition). */}
            <span className="pr-title line-clamp-2 lg:line-clamp-1" data-title={titleName(pull)} style={{ viewTransitionName: movingName(pull) }}>
              {pull.title ?? pull.headline} <span className="font-normal text-faint">#{pull.pr}</span>
            </span>
          </Link>
          {/* A phone has no time column: where and when get a line of their own. */}
          <span className="mt-0.5 block text-[13px] text-faint md:hidden">
            {showRepo && `${pull.repo.split("/")[1]} · `}
            {ago(pull.updatedAt)}
          </span>
          <span className="mt-0.5 line-clamp-2 text-[13px] text-dim max-md:text-[14px] lg:line-clamp-1">
            {showRepo && <span className="text-faint max-md:hidden">{pull.repo.split("/")[1]} · </span>}
            <Why pull={pull} />
          </span>
          {/* No hover on a tablet: the action sits under the text there. A phone has it under a swipe. */}
          <span className="relative z-10 mt-2 flex empty:hidden max-md:hidden lg:hidden">
            <Action pull={pull} asked={asked} ask={ask} />
          </span>
        </span>
        <span className="relative z-10 hidden hover:z-30 focus-within:z-30 lg:block">
          <Pips scenarios={pull.scenarios} onPick={(scenario) => go({ page: "pull", repo: pull.repo, pr: pull.pr, scenario })} />
        </span>
        <span className={`relative z-10 hidden justify-self-end transition-opacity lg:block ${shown}`}>
          <Action pull={pull} asked={asked} ask={ask} />
        </span>
        <span className="whitespace-nowrap pt-0.5 text-right text-[13px] tabular-nums text-faint max-md:hidden lg:pt-0">{ago(pull.updatedAt)}</span>
      </div>
    </li>
  );
}

export const typing = (target: EventTarget | null) => target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);

// Rows and group headings glide to where a new answer puts them (a pull request that turns
// "fixing" moves into its group) instead of jumping: the FLIP technique, keyed by `data-glide`.
// A class for getSnapshotBeforeUpdate: where everything is on screen just before React changes the
// DOM, mid-glide included, so an answer that lands while rows are still moving carries them on from
// where they are instead of restarting them from a spot they've already left.
class Glide extends Component<{ children: ReactNode }> {
  box = createRef<HTMLDivElement>();
  // Where each element sits in the layout, without its glide, in page coordinates (so scrolling
  // between two answers doesn't read as a move).
  placed = new Map<string, number>();

  els = () => [...(this.box.current?.querySelectorAll<HTMLElement>("[data-glide]") ?? [])];
  onScreen = (el: HTMLElement) => el.getBoundingClientRect().top + scrollY;

  componentDidMount() {
    for (const el of this.els()) this.placed.set(el.dataset.glide!, this.onScreen(el));
  }

  getSnapshotBeforeUpdate() {
    return new Map(this.els().map((el) => [el.dataset.glide!, this.onScreen(el)]));
  }

  componentDidUpdate(_props: unknown, _state: unknown, seen: Map<string, number>) {
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const placed = new Map<string, number>();
    for (const el of this.els()) {
      const key = el.dataset.glide!;
      const gliding = el.getAnimations().filter((a) => a.id === "glide");
      const shift = gliding.length > 0 ? new DOMMatrixReadOnly(getComputedStyle(el).transform).m42 : 0;
      const top = this.onScreen(el) - shift;
      placed.set(key, top);
      const was = this.placed.get(key);
      if (calm || this.placed.size === 0) continue;
      if (was === undefined) {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "ease-out" });
        continue;
      }
      // Not moved by this answer: a glide under way just carries on.
      if (Math.abs(was - top) <= 1) continue;
      const from = seen.get(key) ?? was;
      for (const a of gliding) a.cancel();
      const glide = el.animate([{ transform: `translateY(${from - top}px)` }, { transform: "none" }], {
        id: "glide",
        // Speeds up, then settles: a row that crosses the list doesn't leap off on the first frame.
        duration: 460,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
      });
      // A row that passes over others travels above them on the page's own background, so their
      // text doesn't show through it.
      if (Math.abs(from - top) > el.offsetHeight) {
        const lift = { zIndex: "20", transition: "none", ...(getComputedStyle(el).backgroundColor === "rgba(0, 0, 0, 0)" && { backgroundColor: "var(--color-bg)" }) };
        Object.assign(el.style, lift);
        glide.onfinish = glide.oncancel = () => {
          for (const prop of Object.keys(lift)) el.style.removeProperty(prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
        };
      }
    }
    this.placed = placed;
  }

  // Its own stacking context: a lifted row stays above the other rows but never above what lies
  // outside the list, such as the filter menu open over it or the bars on a phone.
  render() {
    return (
      <div ref={this.box} className="isolate">
        {this.props.children}
      </div>
    );
  }
}

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

// Each status with the mark and colour its rows carry in the list.
const STATUSES: { value: Status; label: string; icon: LucideIcon; tone: string }[] = [
  { value: "needs-you", label: "Needs you", icon: CircleX, tone: "text-bad" },
  { value: "working", label: "In progress", icon: CircleDashed, tone: "text-busy" },
  { value: "passed", label: "Passed", icon: CircleCheck, tone: "text-ok" },
];

const menuRow = `flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] ${soft} hover:bg-hover active:bg-hover max-md:h-11 max-md:gap-3 max-md:px-3 max-md:text-[15px] ${focus}`;

type FilterMenuProps = {
  filter: InboxFilter;
  onFilter: (f: Partial<InboxFilter>) => void;
  open: boolean;
  onOpen: (open: boolean) => void;
  repos: string[];
  repo: string | undefined;
  onRepo: (repo: string | undefined) => void;
};

// The filter behind one icon next to the title: a search field and the statuses (on a phone, a sheet,
// with the repositories too, which a desktop has in the sidebar). The icon stays lit while anything
// is filtered out, so a short list never looks like everything.
function FilterMenu({ filter, onFilter, open, onOpen, repos, repo, onRepo }: FilterMenuProps) {
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = useCallback(() => onOpen(false), [onOpen]);
  useDismiss(open, close, box);
  const sheet = useSheetDrag(close);
  // With a mouse, straight into the field. A phone would throw its keyboard over the sheet.
  useEffect(() => {
    if (open && matchMedia("(pointer: fine)").matches) input.current?.focus();
  }, [open]);
  const on = filter.text.trim() !== "" || filter.statuses.length > 0 || !!repo;
  // Any mix of statuses; all of them is the same as none picked, so it reads as All.
  const toggle = (status: Status) => {
    const next = filter.statuses.includes(status) ? filter.statuses.filter((s) => s !== status) : [...filter.statuses, status];
    onFilter({ statuses: next.length === STATUSES.length ? [] : next });
  };
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => onOpen(!open)}
        aria-expanded={open}
        aria-label="Filter"
        title="Filter (/)"
        className={`${iconButton} ${open || on ? "bg-hover text-fg" : ""}`}
      >
        <ListFilter size={16} className="max-md:size-5" />
      </button>
      {open && (
        <>
          <Backdrop onClose={close} />
          <div ref={sheet} className={`${popover} w-72`}>
            <label className="flex h-10 items-center gap-2 border-b border-edge px-3 max-md:mx-4 max-md:mb-2 max-md:mt-2 max-md:h-11 max-md:rounded-lg max-md:border max-md:bg-bg">
              <Search size={15} className="shrink-0 text-faint" />
              <input
                ref={input}
                type="search"
                enterKeyHint="search"
                value={filter.text}
                onChange={(e) => onFilter({ text: e.target.value })}
                onKeyDown={(e) => {
                  // The first Escape empties the field; the next one closes the menu (useDismiss).
                  if (e.key === "Escape" && filter.text) {
                    e.nativeEvent.stopPropagation();
                    onFilter({ text: "" });
                  }
                  if (e.key === "Enter") onOpen(false);
                }}
                aria-label="Filter pull requests"
                placeholder="Title, #number, repository…"
                className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
              />
            </label>
            <div role="group" aria-label="Status" className="p-1.5 max-md:px-2">
              <button type="button" role="checkbox" aria-checked={filter.statuses.length === 0} className={menuRow} onClick={() => onFilter({ statuses: [] })}>
                <InboxIcon size={15} className="shrink-0 text-dim max-md:size-[18px]" />
                <span className="flex-1">All</span>
                {filter.statuses.length === 0 && <Check size={14} className="max-md:size-[18px]" />}
              </button>
              {STATUSES.map((s) => {
                const picked = filter.statuses.includes(s.value);
                return (
                  <button key={s.value} type="button" role="checkbox" aria-checked={picked} className={menuRow} onClick={() => toggle(s.value)}>
                    <s.icon size={15} className={`shrink-0 max-md:size-[18px] ${s.tone}`} />
                    <span className="flex-1">{s.label}</span>
                    {picked && <Check size={14} className="max-md:size-[18px]" />}
                  </button>
                );
              })}
            </div>
            {repos.length > 1 && (
              <div role="radiogroup" aria-label="Repository" className="border-t border-edge px-2 py-1.5 md:hidden">
                <p className="px-3 pb-1 pt-2 text-[13px] font-medium text-faint">Repository</p>
                {[undefined, ...repos].map((name) => (
                  <button key={name ?? "all"} type="button" role="radio" aria-checked={repo === name} className={menuRow} onClick={() => onRepo(name)}>
                    <span className="flex-1 truncate">{name ? name.split("/")[1] : "All repositories"}</span>
                    {repo === name && <Check size={18} />}
                  </button>
                ))}
              </div>
            )}
            {on && (
              <div className="border-t border-edge p-1.5 max-md:px-2">
                <button
                  type="button"
                  className={`${menuRow} text-dim hover:text-fg`}
                  onClick={() => {
                    onFilter(NO_FILTER);
                    onRepo(undefined);
                  }}
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>
        </>
      )}
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
  const all = inRepo.filter((p) => (filter.statuses.length === 0 || filter.statuses.some((s) => statuses[s](p))) && matches(p, filter.text));
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
    const move = (by: number) => selected && setAt(Math.max(0, Math.min(ordered.length - 1, ordered.indexOf(selected) + by)));
    if (e.key === "/") setFilterOpen(true);
    else if (!selected) return;
    else if (e.key === "j" || e.key === "ArrowDown") move(1);
    else if (e.key === "k" || e.key === "ArrowUp") move(-1);
    else if (e.key === "Enter") go({ page: "pull", repo: selected.repo, pr: selected.pr });
    else if (e.key === "f" && kindOf(selected) === "failed" && !selected.paused && !selected.readOnly && !asked(selected)) ask(selected, "fix");
    else if (e.key === "r" && !selected.paused && !selected.readOnly && !asked(selected)) ask(selected, "rerun");
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
            {/* The sidebar says it on a wider screen. */}
            {DEMO && <span className="shrink-0 text-[13px] text-faint md:hidden">Sample data</span>}
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
