import { ArrowUpRight, Check, CircleCheck, CircleX, GitMerge, GitPullRequest, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BRANDS } from "./brands";
import { DAWN } from "./dawn";
import { sampleShipping } from "./demo";
import { Compare, Recording, type Seek } from "./PullScenarioMedia";

// The hero's pull request from broken to merged, as one stage and the pull request's history beside
// it. The history is four moments on a line, on a tile: Kane's run that broke, the fix Kane turned
// down, the fix it passed, and the two runs' last frames side by side. The stage, in the app's dark
// frame, shows the picked moment: Kane's recording, the bag as it still was, the recording after the
// fix, and a line to drag between before and after (the app's own Compare). Under the picture is
// what it shows, in a line: while Kane's recording plays, the step it is on. What a moment says
// stands under the history, all four in one place and only the picked one seen, so nothing on the
// page moves when the moment changes. It plays through once
// by itself from when it is reached, a moment after another, until the visitor picks one; the pull
// request reads Open until the last moment, then Merged.

const DEMO_PR = "https://github.com/t1dem/proofed-demo-store/pull/12#issuecomment-6900830885";
// The demo store's pull request where Kane turned down Claude's first fix and passed the second.
const LOOP_PR = "https://github.com/t1dem/proofed-demo-store/pull/9";

const [fixed, broken] = sampleShipping;
const before = broken!.scenarios[0]!;
const after = fixed!.scenarios[0]!;
const steps = before.steps ?? [];
// The bag where each run ended, the same part of the page in both (cut from the two recordings).
const BAG = { before: "/clips/bag-before.jpg", after: "/clips/bag-after.jpg" };

// The store's own page colour, around a picture that has no controls under it.
const PAGE = "#f6efe5";

const link = "whitespace-nowrap font-semibold text-[#111] underline decoration-black/30 underline-offset-4 hover:decoration-black";
const line = "flex gap-2.5 text-[16px] leading-snug sm:text-[15px]";
const small = "text-[16px] leading-snug text-black/65 sm:text-[14.5px]";
const code = "whitespace-nowrap font-mono text-[0.9em]";

const claude = (
  <svg viewBox="0 0 24 24" role="img" aria-label="Claude" className="mt-0.5 size-[17px] shrink-0 fill-current">
    <path d={BRANDS.claude} />
  </svg>
);

// A moment of the history: its mark on the line and its name. What it says when picked is in
// `says` below, by its place.
const MOMENTS: { name: string; mark: ReactNode }[] = [
  { name: "Kane finds what the diff broke", mark: <X size={18} strokeWidth={3} /> },
  { name: "Attempt 1: not pushed", mark: <X size={18} strokeWidth={3} /> },
  { name: "Attempt 2: pushed", mark: <Check size={18} strokeWidth={3} /> },
  { name: "Before the fix and after", mark: <GitMerge size={18} strokeWidth={2.5} /> },
];
const LAST = MOMENTS.length - 1;

// A picture with no controls of its own stands as tall as a recording with its controls.
function Still({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: PAGE }} className="py-[22.5px]">
      {children}
    </div>
  );
}

export function PullShowcase() {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  // Playing through by itself, until the visitor picks a moment or a step.
  const [auto, setAuto] = useState(true);
  const [seek, setSeek] = useState<Seek>();
  const [time, setTime] = useState<number>();
  const later = useRef(0);
  const play = (from: number) => setSeek((s) => ({ at: from, n: (s?.n ?? 0) + 1 }));
  const show = (i: number) => {
    setAt(i);
    setTime(undefined);
    play(0);
  };
  const pick = (i: number) => {
    clearTimeout(later.current);
    setAuto(false);
    show(i);
    // On a phone the stage is above the history: bring it back if it has gone off the top.
    if ((box.current?.getBoundingClientRect().top ?? 0) < 0) box.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  const next = (after: number) => {
    if (auto) later.current = window.setTimeout(() => show(at + 1), after);
  };

  // The recording plays once when it scrolls into view; the step on screen is lit, and a step plays
  // the clip from its moment.
  useEffect(() => {
    const el = box.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const seen = new IntersectionObserver(([e]) => e?.isIntersecting && (play(0), seen.disconnect()), { threshold: 0.6 });
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  // The bag as it still was has nothing to play: it stays a few seconds.
  useEffect(() => {
    if (at === 1) next(4000);
    return () => clearTimeout(later.current);
  }, [at]);
  // The step Kane's recording is on; before it plays, the one it broke on, which is the frame it shows.
  const step = (time === undefined ? undefined : steps.findLast((s) => (s.at ?? 0) <= time)) ?? steps.at(-1)!;
  const merged = at === LAST;

  const says: ReactNode[] = [
    <p className={line}>
      <CircleX aria-label="Failed" size={17} strokeWidth={2.25} className="mt-0.5 shrink-0" />
      <span>{before.reason}</span>
    </p>,
    <>
      <p className={line}>
        {claude}
        <span>Changed the note under the headline only.</span>
      </p>
      <p className={`mt-2.5 ${line}`}>
        <CircleX aria-label="Failed" size={17} strokeWidth={2.25} className="mt-0.5 shrink-0" />
        <span>
          <span className="font-semibold">Kane:</span> the bag still gave free shipping at €44.50.
        </span>
      </p>
      <p className={`mt-4 ${small}`}>Kane runs the same scenario on every fix. Only the one it passes is pushed.</p>
    </>,
    <>
      <p className={line}>
        {claude}
        <span>
          Put the threshold back in cents, <code className={code}>50 * 100</code>, in <code className={code}>src/pricing.ts</code>.
        </span>
      </p>
      <p className={`mt-2.5 ${line}`}>
        <CircleCheck aria-label="Passed" size={17} strokeWidth={2.25} className="mt-0.5 shrink-0" />
        <span>
          <span className="font-semibold">Kane:</span> shipping is €4.90 at €49.40 and Free at €51.00.
        </span>
      </p>
      <p className={`mt-4 ${small}`}>
        A real pull request where this happened:{" "}
        <a href={LOOP_PR} className={link}>
          proofed-demo-store #9
        </a>
      </p>
    </>,
    <p className={line}>Where Kane's run ended each time. Drag the line.</p>,
  ];

  return (
    <section id="how" className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <h2 className="max-w-4xl text-[2.2rem] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-balance sm:text-5xl">
          One pull request, <span className="text-faint">from broken to merged.</span>
        </h2>
        <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-dim">
          The pull request writes the free shipping threshold in euros. The cart still counts in cents, so a €44.50 bag ships free.
        </p>

        <div className="mt-12 grid gap-3 xl:grid-cols-12">
          <div ref={box} className="flex scroll-mt-4 flex-col overflow-hidden rounded-3xl border border-edge bg-bg xl:col-span-8">
            {at === 0 && <Recording key="broke" clip={before.clip!} steps={steps} seek={seek} onTime={setTime} onEnd={() => next(1200)} />}
            {at === 1 && (
              <Still>
                <img src={BAG.before} alt="The bag after Claude's first fix: shipping is still Free at €44.50" className="block aspect-video w-full" />
              </Still>
            )}
            {at === 2 && <Recording key="fixed" clip={after.clip!} seek={seek} onEnd={() => next(1200)} />}
            {at === 3 && (
              <Still>
                <Compare before={BAG.before} after={BAG.after} />
              </Still>
            )}
            <div className="flex min-h-[7.5rem] flex-1 flex-col justify-center gap-x-6 gap-y-1.5 border-t border-edge px-4 py-3 sm:min-h-[4.25rem] sm:flex-row sm:items-center sm:justify-between">
              <p className="flex min-w-0 items-center gap-2.5 text-[16px] leading-snug sm:text-[15px]">
                {at === 0 && (
                  <>
                    {step.failed ? (
                      <CircleX aria-label="Failed" size={17} strokeWidth={2.25} className="shrink-0 text-bad" />
                    ) : (
                      <span className="w-[17px] shrink-0 text-center text-[13px] tabular-nums text-faint">{steps.indexOf(step) + 1}</span>
                    )}
                    <span className={step.failed ? "font-medium" : "text-dim"}>{step.remark}</span>
                  </>
                )}
                {at === 1 && <span className="text-dim">The bag after the first fix. Shipping is still Free at €44.50.</span>}
                {at === 2 && (
                  <>
                    <CircleCheck aria-label="Passed" size={17} strokeWidth={2.25} className="shrink-0 text-ok" />
                    <span className="font-medium">{after.reason}</span>
                  </>
                )}
                {at === 3 && <span className="text-dim">Before: Free, total €44.50. After: €4.90, total €49.40.</span>}
              </p>
              <a
                href={DEMO_PR}
                title="The pull request in these pictures"
                className="inline-flex shrink-0 items-center gap-1 self-start whitespace-nowrap text-[16px] text-dim underline decoration-white/20 underline-offset-4 transition-colors hover:text-fg sm:self-auto sm:text-[14px]"
              >
                proofed-demo-store #12 <ArrowUpRight aria-hidden size={15} strokeWidth={2.25} />
              </a>
            </div>
          </div>

          <div style={{ "--fill": DAWN.sand } as CSSProperties} className="tile grid content-start gap-x-10 gap-y-6 rounded-3xl p-6 sm:grid-cols-2 sm:p-7 xl:col-span-4 xl:grid-cols-1">
            <div>
              <p className="flex items-center gap-2.5 text-[15px] font-medium text-black/65">
                <span className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold text-white transition-colors duration-300 ${merged ? "bg-[#8250df]" : "bg-[#238636]"}`}>
                  {merged ? <GitMerge aria-hidden size={14} strokeWidth={2.25} /> : <GitPullRequest aria-hidden size={14} strokeWidth={2.25} />}
                  {merged ? "Merged" : "Open"}
                </span>
                storefront #26
              </p>

              <ol className="mt-6">
                {MOMENTS.map((m, i) => (
                  <li key={m.name} className="relative pb-3 last:pb-0">
                    {/* The line down to the next moment, inked once that moment is reached. */}
                    {i < LAST && <span aria-hidden className={`absolute bottom-0 left-[calc(1.125rem-1.5px)] top-9 w-[3px] transition-colors duration-300 ${i < at ? "bg-[#111]" : "bg-black/15"}`} />}
                    <button type="button" onClick={() => pick(i)} aria-current={i === at ? "step" : undefined} className="group grid w-full cursor-pointer grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-x-3.5 text-left">
                      <span
                        aria-hidden
                        className={`relative grid size-9 place-items-center rounded-full transition-colors duration-300 ${
                          i <= at ? "bg-[#111] text-[color-mix(in_srgb,var(--fill),#fff_45%)]" : "text-black/40 shadow-[inset_0_0_0_3px_rgb(0_0_0/0.18)] group-hover:text-black/70"
                        }`}
                      >
                        {m.mark}
                      </span>
                      <span className={`text-[18px] font-semibold leading-tight tracking-[-0.02em] transition-colors duration-300 ${i === at ? "" : "text-black/55 group-hover:text-black/80"}`}>{m.name}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>

            <div className="grid border-black/15 max-sm:border-t max-sm:pt-5 sm:border-l sm:pl-10 xl:border-l-0 xl:border-t xl:pl-0 xl:pt-5">
              {says.map((said, i) => (
                <div key={i} inert={i !== at} className={`col-start-1 row-start-1 transition-opacity duration-300 ${i === at ? "" : "invisible opacity-0"}`}>
                  {said}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
