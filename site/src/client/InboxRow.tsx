import { RotateCw, Wrench } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { NOTHING_CHECKED } from "../../../src/report/runfile";
import type { PullView } from "../worker/runs";
import { ago, canAskAgain, fixLabel, fixerName, movingName, plural, prefetch, titleName, type Ask, type Route, type useAsk } from "./lib";
import { kindOf, Link, Mark, NEEDS_WRITE, outline, Pips, plain, sha7, soft, solid } from "./ui";

export type AskedOf = ReturnType<typeof useAsk>[0];

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
  if (typeof state === "object" && !state.retryable) return null;
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
      {fix ? fixLabel(pull) : "Run again"}
    </button>
  );
}

type RowProps = { pull: PullView; selected: boolean; go: (route: Route) => void; asked: AskedOf; ask: Ask; showRepo: boolean };

// What a phone's swipe on a row offers: the same one action the desktop row has (Action).
function swipeAction(pull: PullView, asked: AskedOf) {
  const kind = kindOf(pull);
  if (pull.paused || pull.readOnly || !canAskAgain(asked(pull)) || (kind !== "failed" && kind !== "error")) return undefined;
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
    const cancel = () => {
      if (axis === "x") slide(isOpen.current ? -SWIPE : 0);
      axis = undefined;
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", up);
    el.addEventListener("touchcancel", cancel);
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", up);
      el.removeEventListener("touchcancel", cancel);
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

export function Row({ pull, selected, go, asked, ask, showRepo }: RowProps) {
  const ref = useRef<HTMLLIElement>(null);
  const detail = `/api/pulls/${pull.repo}/${pull.pr}`;
  const state = asked(pull);
  const swipe = swipeAction(pull, asked);
  const { content, open, close } = useSwipe(!!swipe);
  useEffect(() => {
    if (!selected) return;
    ref.current?.scrollIntoView({ block: "nearest" });
    prefetch(detail);
  }, [selected, detail]);
  // The action waits in its own column: shown on the keyboard's row and under the mouse, so the
  // column doesn't jump from row to row. Once asked, the answer stays in view.
  const shown = selected || !!state ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100";
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
          {typeof state === "object" && <span role="status" className="mt-0.5 block text-[13px] text-bad">{state.error}</span>}
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
