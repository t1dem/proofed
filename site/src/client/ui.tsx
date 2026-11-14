import { CircleCheck, CircleDashed, CircleExclamationPoint, CircleMinus, CircleQuestionMark, CircleX, LoaderCircle, type LucideIcon } from "lucide-react";
import { useEffect, useRef, type MouseEvent, type ReactNode, type RefObject } from "react";
import type { MeView } from "../worker/api";
import type { Outcome, PullView } from "../worker/runs";
import { pathOf, type Route } from "./lib";

export const focus = "outline-none focus-visible:ring-2 focus-visible:ring-fg/50";
// 44px tall on a phone: a finger, not a pointer.
const button = `inline-flex h-8 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-colors disabled:opacity-50 max-md:h-11 max-md:rounded-lg max-md:px-4 max-md:text-[15px] ${focus}`;
export const solid = `${button} bg-fg text-bg hover:bg-fg/85`;
export const outline = `${button} border border-edge hover:bg-hover`;
export const iconButton = `inline-grid size-8 shrink-0 place-items-center rounded-md text-dim transition-colors hover:bg-hover hover:text-fg active:bg-hover max-md:size-11 ${focus}`;
export const field = `h-9 w-full rounded-md border border-edge bg-panel px-3 font-mono text-[13px] max-md:h-11 max-md:rounded-lg ${focus}`;
export const link = "underline decoration-edge underline-offset-4 hover:decoration-fg";
// A hover fill that comes in quickly and fades out slowly, so moving down a list leaves a soft trail
// instead of each item switching on and off. (The base duration is the fade out, hover's the fade in.)
export const soft = "transition-colors duration-300 ease-out hover:duration-150";

type Go = (route: Route) => void;

// A real link (so ⌘-click opens a tab) that otherwise navigates without a page load.
export function Link({ to, go, className, title, children }: { to: Route; go: Go; className?: string; title?: string; children: ReactNode }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go(to);
    // A mouse click shouldn't leave the keyboard focus ring on the link; Enter (detail 0) keeps it.
    if (e.detail > 0) e.currentTarget.blur();
  };
  return (
    <a href={pathOf(to)} onClick={onClick} title={title} className={`${focus} ${className ?? ""}`}>
      {children}
    </a>
  );
}

// "waiting": a scenario of a run that is going, in line for a Chrome (Live.tsx).
export type Kind = Outcome | "fixing" | "running" | "skipped" | "waiting";

// What a pull request's row says at a glance.
export function kindOf(pull: PullView): Kind {
  if (pull.state === "fixing") return "fixing";
  if (pull.state === "running") return "running";
  if (pull.state === "failing") return "failed";
  if (pull.state === "blocked") return "error";
  return pull.scenarios.some((s) => s.outcome === "unsure") ? "unsure" : "passed";
}

export const marks: Record<Kind, { icon: LucideIcon; text: string; fill: string; label: string }> = {
  passed: { icon: CircleCheck, text: "text-ok", fill: "bg-ok", label: "Passed" },
  failed: { icon: CircleX, text: "text-bad", fill: "bg-bad", label: "Broke" },
  unsure: { icon: CircleQuestionMark, text: "text-busy", fill: "bg-busy", label: "Not confirmed" },
  error: { icon: CircleExclamationPoint, text: "text-dim", fill: "bg-faint", label: "Kane couldn't finish" },
  fixing: { icon: LoaderCircle, text: "text-work", fill: "bg-work", label: "Claude is fixing" },
  running: { icon: LoaderCircle, text: "text-busy", fill: "bg-busy", label: "Kane is checking" },
  skipped: { icon: CircleMinus, text: "text-faint", fill: "bg-edge", label: "Not run" },
  waiting: { icon: CircleDashed, text: "text-faint", fill: "bg-edge", label: "Waiting" },
};

export function Mark({ kind, size = 16 }: { kind: Kind; size?: number }) {
  const { icon: Icon, text, label } = marks[kind];
  return (
    <span role="img" aria-label={label} title={label} className={`inline-grid shrink-0 place-items-center ${text}`}>
      <Icon size={size} strokeWidth={2} className={kind === "fixing" || kind === "running" ? "animate-spin" : undefined} />
    </span>
  );
}

// One square per scenario of the latest run. With `onPick` each one opens its scenario, and says
// which it is at once on hover (a native title takes a second to show), above and to the left of the
// square so it never lands on the row's button on the right.
export function Pips({ scenarios, onPick }: { scenarios: PullView["scenarios"]; onPick?: (name: string) => void }) {
  return (
    <span className="flex">
      {scenarios.map((s, i) => {
        const says = `${s.name}: ${marks[s.outcome].label.toLowerCase()}`;
        const square = <span className={`block size-2.5 rounded-[2px] transition-transform duration-150 group-hover/pip:scale-125 ${marks[s.outcome].fill}`} />;
        if (!onPick) {
          return (
            <span key={i} title={says} className="p-[1.5px]">
              {square}
            </span>
          );
        }
        return (
          <button key={i} type="button" aria-label={says} onClick={() => onPick(s.name)} className={`group/pip relative rounded-[3px] p-[1.5px] ${focus}`}>
            {square}
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-full right-0 z-30 mb-2 whitespace-nowrap rounded-md border border-edge bg-panel px-2 py-1 text-[12px] text-fg opacity-0 shadow-lg shadow-black/20 transition-opacity duration-100 group-hover/pip:opacity-100 group-focus-visible/pip:opacity-100"
            >
              {says}
            </span>
          </button>
        );
      })}
    </span>
  );
}

type SegmentedProps<T extends string> = {
  label: string;
  value: T | undefined;
  options: readonly { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
};

// A row of buttons for a short list of choices: everything is visible, one click picks.
export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-md border border-edge bg-panel p-0.5">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => !on && onChange(option.value)}
            className={`h-7 rounded-[5px] px-2.5 text-[13px] max-md:h-9 max-md:px-3 max-md:text-[14px] ${soft} ${focus} ${on ? "bg-hover font-medium text-fg shadow-[inset_0_0_0_1px_var(--color-edge)]" : "text-dim hover:bg-hover/50 hover:text-fg"}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// A menu or panel that closes on a click outside `box` or on Escape.
export function useDismiss(open: boolean, close: () => void, box: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onEvent = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) close();
    };
    addEventListener("pointerdown", onEvent);
    addEventListener("keydown", onEvent);
    return () => {
      removeEventListener("pointerdown", onEvent);
      removeEventListener("keydown", onEvent);
    };
  }, [open, close, box]);
}

// A page's big card. On a phone it runs edge to edge (cancelling main's px-4), so what's inside it,
// the recording above all, gets the whole width instead of losing 40px to a frame.
export const panel = "-mx-4 overflow-clip border-y border-edge bg-panel sm:mx-0 sm:rounded-xl sm:border";

// A menu under its button; on a phone, a sheet from the bottom (with a Backdrop and useSheetDrag) and
// a grab handle on top.
export const popover =
  "absolute right-0 top-full z-20 mt-1.5 rounded-lg border border-edge bg-panel shadow-xl shadow-black/30 " +
  "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:top-auto max-md:z-50 max-md:mt-0 max-md:max-h-[85dvh] max-md:w-auto max-md:overflow-y-auto max-md:overscroll-contain max-md:rounded-b-none max-md:rounded-t-2xl max-md:border-x-0 max-md:border-b-0 max-md:pb-[env(safe-area-inset-bottom)] max-md:animate-[sheet-up_280ms_cubic-bezier(0.2,0.8,0.2,1)] " +
  "max-md:before:mx-auto max-md:before:mb-1 max-md:before:mt-2 max-md:before:block max-md:before:h-1 max-md:before:w-9 max-md:before:rounded-full max-md:before:bg-edge max-md:before:content-['']";

// The page dimmed behind a menu that is a sheet on a phone. It sits inside the menu's box, so
// useDismiss doesn't see a tap on it as outside; the tap closes the menu here and goes no further.
export function Backdrop({ onClose }: { onClose: () => void }) {
  // A span, so it can sit inside a line of text (RunMeta) too.
  return <span aria-hidden onClick={onClose} className="fixed inset-0 z-40 block animate-[fade-in_200ms_ease-out] bg-black/50 md:hidden" />;
}

// A sheet follows a finger dragging it down from its top (when it isn't scrolled) and closes past
// a third of its height or on a quick flick; otherwise it springs back.
export function useSheetDrag<T extends HTMLElement = HTMLDivElement>(close: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start: { y: number; t: number } | undefined;
    let dy = 0;
    const down = (e: TouchEvent) => {
      start = el.scrollTop <= 0 ? { y: e.touches[0]!.clientY, t: e.timeStamp } : undefined;
      dy = 0;
    };
    const move = (e: TouchEvent) => {
      if (!start) return;
      dy = e.touches[0]!.clientY - start.y;
      if (dy <= 0) return void (el.style.transform = "");
      e.preventDefault();
      el.style.transition = "none";
      el.style.transform = `translateY(${dy}px)`;
    };
    const up = (e: TouchEvent) => {
      if (!start || dy <= 0) return;
      const flick = dy / (e.timeStamp - start.t) > 0.6;
      el.style.transition = "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)";
      if (dy > el.offsetHeight / 3 || flick) {
        el.style.transform = "translateY(100%)";
        setTimeout(close, 200);
      } else el.style.transform = "";
      start = undefined;
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", up);
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", up);
    };
  }, [close]);
  return ref;
}

// The page's own title, above its content; no bar around it.
// `sub` is a quiet line under the title that stays with it when the actions wrap below on a phone.
// On a phone, `onPhone: "bar"` (the default) turns it into the screen's top bar: small, sticky, with
// the page's actions on the right. A pull request keeps its long title in the page ("title") and has
// a MobileBar of its own above it.
export function PageTitle({ children, aside, sub, onPhone = "bar" }: { children: ReactNode; aside?: ReactNode; sub?: ReactNode; onPhone?: "bar" | "title" }) {
  const bar = onPhone === "bar";
  return (
    <header
      className={`flex min-h-9 flex-wrap items-center gap-x-4 gap-y-3 ${bar ? "max-md:sticky max-md:top-0 max-md:z-30 max-md:-mx-4 max-md:h-(--bar) max-md:flex-nowrap max-md:pt-[env(safe-area-inset-top)] max-md:border-b max-md:border-edge max-md:bg-bg max-md:pl-4 max-md:pr-2" : ""}`}
    >
      <div className="min-w-0 flex-1 basis-48">
        <h1
          className={`font-serif tracking-[-0.01em] ${bar ? "text-[28px] leading-[34px] max-md:truncate max-md:font-sans max-md:text-[17px] max-md:font-semibold max-md:leading-6 max-md:tracking-normal" : "text-[24px] leading-[30px] md:text-[28px] md:leading-[34px]"}`}
        >
          {children}
        </h1>
        {sub}
      </div>
      {aside}
    </header>
  );
}

// A phone's top bar where the page title can't be it (a pull request): a way back, what this is,
// and an action or two on the right.
export function MobileBar({ back, title, actions }: { back: ReactNode; title: ReactNode; actions?: ReactNode }) {
  return (
    <div className="sticky top-0 z-30 -mx-4 flex h-(--bar) items-center gap-0.5 border-b border-edge bg-bg px-1 pt-[env(safe-area-inset-top)] md:hidden">
      {back}
      <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</p>
      {actions}
    </div>
  );
}

export function Avatar({ me }: { me: MeView }) {
  if (me.avatar) return <img src={me.avatar} alt="" className="size-6 shrink-0 rounded-full" />;
  return <span className="grid size-6 shrink-0 place-items-center rounded-full bg-hover text-[12px] font-semibold uppercase text-dim">{me.login[0]}</span>;
}

export const sha7 = (sha: string) => sha.slice(0, 7);

// Kane starts each remark with the kind of step ("click: Clicking Pause"); the words alone say it.
export const plain = (remark: string) => {
  const text = remark.replace(/^[a-z_]+:\s+/, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// A grey stand-in for text or a frame that's still loading, in the shape of what comes.
export const bone = "animate-pulse rounded bg-hover";
