import { CircleCheck, CircleDashed, CircleExclamationPoint, CircleMinus, CircleQuestionMark, CircleX, LoaderCircle, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import type { MeView } from "../worker/api";
import type { Outcome, PullView } from "../worker/runs";
import { pathOf, type Route } from "./lib";

export const focus = "outline-none focus-visible:ring-2 focus-visible:ring-fg/50";
// 44px tall on a phone: a finger, not a pointer.
const shape = "inline-flex h-8 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-colors disabled:opacity-50 max-md:h-11 max-md:rounded-lg max-md:px-4 max-md:text-[15px]";
const button = `${shape} ${focus}`;
// The one call to action on a screen: raised, in the accent (.raised in index.css). Its focus ring is an
// outline, as a box-shadow ring would replace the shadows that raise it.
export const solid = `${shape} raised`;
export const outline = `${button} border border-edge hover:bg-hover disabled:hover:bg-transparent`;
// A quiet filled button: a control that belongs to a row (the model, the next step) rather than a call to action.
export const subtle = `${button} bg-fg/[0.06] text-fg hover:bg-fg/[0.1] active:bg-fg/[0.12] disabled:hover:bg-fg/[0.06]`;
// The title of a button that's there but greyed out: the signed-in user can't push to the repo.
export const NEEDS_WRITE = "Needs write access to this repository";
export const iconButton = `inline-grid size-8 shrink-0 place-items-center rounded-md text-dim transition-colors hover:bg-hover hover:text-fg active:bg-hover max-md:size-11 ${focus}`;
// A field is a well in the surface it sits on (.inset in index.css).
export const field = `inset h-9 w-full rounded-lg px-3 font-mono text-[13px] max-md:h-11`;
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

// The product's name with its mark, wherever the app shows who it is.
export function Logo({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`flex items-center gap-2 font-semibold tracking-[-0.01em] ${className}`}>
      <img src="/favicon.svg" alt="" className="rounded-[5px]" style={{ width: size, height: size }} />
      Proofed
    </span>
  );
}

// A key as printed on the keyboard: in hints next to menu items, the palette's footer and the shortcuts sheet.
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-[5px] border border-edge bg-bg px-1 font-sans text-[11px] font-medium leading-none text-dim">
      {children}
    </kbd>
  );
}

// A repository's two letters on a tinted square, the same tint wherever it shows, so a row says
// which repository it is from at a glance without reading the name.
const chipTints = [
  "bg-[#8fa6ff]/15 text-[#8fa6ff]",
  "bg-[#4cc373]/15 text-[#4cc373]",
  "bg-[#e0ad4a]/15 text-[#d29a32]",
  "bg-[#c08cff]/15 text-[#b07af5]",
  "bg-[#f2625a]/15 text-[#ef5a52]",
  "bg-[#4cc3c3]/15 text-[#3fb5b5]",
];
const initials = (repo: string) => {
  const name = repo.split("/").pop() ?? repo;
  const words = name.split(/[-_.\s]+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")).toUpperCase();
};
export function RepoChip({ repo, size = 16, round = "rounded-[4px]" }: { repo: string; size?: number; round?: string }) {
  let hash = 0;
  for (const c of repo) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden
      className={`inline-grid shrink-0 place-items-center font-semibold leading-none tracking-[-0.02em] ${round} ${chipTints[hash % chipTints.length]}`}
      style={{ width: size, height: size, fontSize: Math.round(size * (size > 24 ? 0.36 : 0.5)) }}
    >
      {initials(repo)}
    </span>
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
  fixing: { icon: LoaderCircle, text: "text-work", fill: "bg-work", label: "Fix in progress" },
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
              className="pointer-events-none absolute bottom-full right-0 z-30 mb-2 whitespace-nowrap rounded-lg border border-edge bg-panel px-2 py-1 text-[12px] text-fg opacity-0 shadow-xl shadow-black/30 transition-opacity duration-100 group-hover/pip:opacity-100 group-focus-visible/pip:opacity-100"
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

// A row of buttons for a short list of choices: everything is visible, one click picks. The picked
// one sits on a raised thumb that slides to the next pick. Arrow keys move the pick, as in any radio group.
export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  const track = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number; moved: boolean }>();
  const at = options.findIndex((o) => o.value === value);
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    // Measured, so each choice keeps its own width; again when the fonts land or the row reflows.
    const place = () => {
      const button = el.children[at + 1] as HTMLElement | undefined;
      setThumb((before) => (button ? { x: button.offsetLeft, w: button.offsetWidth, moved: !!before } : undefined));
    };
    place();
    const watch = new ResizeObserver(place);
    watch.observe(el);
    return () => watch.disconnect();
  }, [at]);
  const pick = (i: number) => {
    const option = options[(i + options.length) % options.length]!;
    onChange(option.value);
    (track.current?.children[options.indexOf(option) + 1] as HTMLElement | undefined)?.focus();
  };
  return (
    <div ref={track} role="radiogroup" aria-label={label} className="seg-track relative inline-flex rounded-[9px] p-[3px]">
      <span
        aria-hidden
        className={`seg-thumb pointer-events-none absolute inset-y-[3px] left-0 rounded-[7px] ${thumb?.moved ? "transition-[transform,width] duration-[260ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]" : ""} ${thumb ? "" : "hidden"}`}
        style={thumb && { width: thumb.w, transform: `translateX(${thumb.x}px)` }}
      />
      {options.map((option, i) => {
        const on = i === at;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (at < 0 && i === 0) ? 0 : -1}
            onClick={() => !on && onChange(option.value)}
            onKeyDown={(e) => {
              const by = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
              if (!by) return;
              e.preventDefault();
              pick(i + by);
            }}
            className={`relative h-[26px] whitespace-nowrap rounded-[7px] px-3 text-[13px] font-medium outline-none transition-colors duration-200 focus-visible:ring-1 focus-visible:ring-fg/40 max-md:h-8 max-md:px-3.5 max-md:text-[14px] ${on ? "text-fg" : "text-faint hover:text-dim"}`}
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
  "absolute right-0 top-full z-20 mt-1.5 origin-top-right rounded-xl border border-edge bg-panel shadow-2xl shadow-black/40 md:animate-[menu-in_170ms_cubic-bezier(0.16,1,0.3,1)] " +
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
export function useSheetDrag<T extends HTMLElement = HTMLDivElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    let start: { y: number; t: number } | undefined;
    let dy = 0;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const down = (e: TouchEvent) => {
      if (closeTimer !== undefined) return;
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
        closeTimer = setTimeout(close, 200);
      } else el.style.transform = "";
      start = undefined;
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", up);
    return () => {
      clearTimeout(closeTimer);
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", up);
    };
  }, [open, close]);
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
          className={`font-semibold tracking-[-0.015em] ${bar ? "text-[22px] leading-8 max-md:truncate max-md:text-[17px] max-md:leading-6 max-md:tracking-normal" : "text-[20px] leading-7 md:text-[22px] md:leading-8"}`}
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
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#8fa6ff] to-[#b07af5] text-[11px] font-semibold uppercase text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.15)]">
      {me.login[0]}
    </span>
  );
}

export const sha7 = (sha: string) => sha.slice(0, 7);

// Kane starts each remark with the kind of step ("click: Clicking Pause"); the words alone say it.
// Kane's remark is "<kind>: <text>", the text cut at 80 characters, sometimes mid-word. An analyze
// step's text can be the raw call, ANALYZE(textual_visual, '<what it checks>'), and a wait's can
// start with "PRIMARY:"; only what it checks is shown.
const KANE_CUT = 80;
export const plain = (remark: string) => {
  let text = remark.replace(/^[a-z_]+:\s+/, "");
  const cut = text.length >= KANE_CUT;
  // Only a raw call ends in its own bracket: "Clicking Bag (3)" keeps its.
  const call = /^[A-Z_]+\([a-z_]+,\s*['"]?/;
  if (call.test(text)) text = text.replace(call, "").replace(/['"]?\)$/, "");
  text = text.replace(/^PRIMARY:\s*/, "");
  if (cut) text = `${text.replace(/\s+\S*$/, "")}…`;
  // A repository name ("t1dem/proofed …") keeps its case.
  return /^\S*\//.test(text) ? text : text.charAt(0).toUpperCase() + text.slice(1);
};

// A grey stand-in for text or a frame that's still loading, in the shape of what comes.
export const bone = "animate-pulse rounded bg-hover";
