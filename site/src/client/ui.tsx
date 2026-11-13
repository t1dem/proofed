import { CircleCheck, CircleExclamationPoint, CircleMinus, CircleQuestionMark, CircleX, LoaderCircle, type LucideIcon } from "lucide-react";
import { useEffect, type MouseEvent, type ReactNode, type RefObject } from "react";
import type { Outcome, PullView } from "../worker/runs";
import { pathOf, type Route } from "./lib";

export const focus = "outline-none focus-visible:ring-2 focus-visible:ring-fg/50";
const button = `inline-flex h-8 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-colors disabled:opacity-50 ${focus}`;
export const solid = `${button} bg-fg text-bg hover:bg-fg/85`;
export const outline = `${button} border border-edge hover:bg-hover`;
export const iconButton = `inline-grid size-8 shrink-0 place-items-center rounded-md text-dim transition-colors hover:bg-hover hover:text-fg ${focus}`;
export const field = `h-9 w-full rounded-md border border-edge bg-panel px-3 font-mono text-[13px] ${focus}`;
export const link = "underline decoration-edge underline-offset-4 hover:decoration-fg";

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

export type Kind = Outcome | "fixing" | "skipped";

// What a pull request's row says at a glance.
export function kindOf(pull: PullView): Kind {
  if (pull.state === "fixing") return "fixing";
  if (pull.state === "failing") return "failed";
  if (pull.state === "blocked") return "error";
  return pull.scenarios.some((s) => s.outcome === "unsure") ? "unsure" : "passed";
}

export const marks: Record<Kind, { icon: LucideIcon; text: string; fill: string; label: string }> = {
  passed: { icon: CircleCheck, text: "text-ok", fill: "bg-ok", label: "Passed" },
  failed: { icon: CircleX, text: "text-bad", fill: "bg-bad", label: "Broke" },
  unsure: { icon: CircleQuestionMark, text: "text-busy", fill: "bg-busy", label: "The test may be wrong" },
  error: { icon: CircleExclamationPoint, text: "text-dim", fill: "bg-faint", label: "Kane couldn't finish" },
  fixing: { icon: LoaderCircle, text: "text-work", fill: "bg-work", label: "Claude is fixing" },
  skipped: { icon: CircleMinus, text: "text-faint", fill: "bg-edge", label: "Not run" },
};

export function Mark({ kind, size = 16 }: { kind: Kind; size?: number }) {
  const { icon: Icon, text, label } = marks[kind];
  return (
    <span role="img" aria-label={label} title={label} className={`inline-grid shrink-0 place-items-center ${text}`}>
      <Icon size={size} strokeWidth={2} className={kind === "fixing" ? "animate-spin" : undefined} />
    </span>
  );
}

// One square per scenario of the latest run.
export function Pips({ scenarios }: { scenarios: PullView["scenarios"] }) {
  return (
    <span className="flex gap-[3px]">
      {scenarios.map((s, i) => (
        <span key={i} title={`${s.name}: ${marks[s.outcome].label.toLowerCase()}`} className={`size-2.5 rounded-[2px] ${marks[s.outcome].fill}`} />
      ))}
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
            className={`h-7 rounded-[5px] px-2.5 text-[13px] transition-colors ${focus} ${on ? "bg-hover font-medium text-fg shadow-[inset_0_0_0_1px_var(--color-edge)]" : "text-dim hover:text-fg"}`}
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

export const popover = "absolute right-0 top-full z-20 mt-1.5 rounded-lg border border-edge bg-panel shadow-xl shadow-black/30";

// The page's own title, above its content; no bar around it.
// `sub` is a quiet line under the title that stays with it when the actions wrap below on a phone.
export function PageTitle({ children, aside, sub }: { children: ReactNode; aside?: ReactNode; sub?: ReactNode }) {
  return (
    <header className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1 basis-72">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{children}</h1>
        {sub}
      </div>
      {aside}
    </header>
  );
}

export const sha7 = (sha: string) => sha.slice(0, 7);
