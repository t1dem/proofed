// The central piece of the landing: PR #2 of the demo store, replayed step by step.
// Everything shown here happened on that PR: the diff, Kane's recordings, the fix commit.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

const PR_URL = "https://github.com/t1dem/proofed-demo-store/pull/2";
const FIX_URL = "https://github.com/t1dem/proofed-demo-store/commit/84514dbd32279572679948eb3baa665756740ba7";

type DiffLine = { sign: "+" | "-" | " "; text: string };

// `commit` is the real one this diff is from, with its time on 13 November (UTC).
function Diff({ lines, commit }: { lines: DiffLine[]; commit: string }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-line bg-card">
      <figcaption className="flex justify-between gap-4 border-b border-line px-4 py-2.5 font-mono text-[13px] text-muted">
        <span>src/pricing.ts</span>
        <span>{commit}</span>
      </figcaption>
      <pre className="whitespace-pre-wrap break-words py-2 font-mono text-[13px] leading-6 sm:text-sm">
        {lines.map((l, i) => (
          <div
            key={i}
            className={`py-0.5 pl-8 pr-4 -indent-4 ${l.sign === "+" ? "bg-pass-bg text-pass" : l.sign === "-" ? "bg-fail-bg text-fail" : "text-muted"}`}
          >
            <span className="mr-3 select-none opacity-60">{l.sign}</span>
            {l.text}
          </div>
        ))}
      </pre>
    </figure>
  );
}

export function Status({ pass, children }: { pass: boolean; children: ReactNode }) {
  return (
    <p className={`flex items-start gap-2.5 text-[15px] ${pass ? "text-pass" : "text-fail"}`}>
      <span aria-hidden className="mt-px font-semibold">
        {pass ? "✓" : "✗"}
      </span>
      <span>
        <strong className="font-semibold">Proofed</strong> <span className="text-ink/80">— {children}</span>
      </span>
    </p>
  );
}

// Plays while its step is on screen. The clip zooms in on what Kane flagged by itself
// (Proofed renders it that way); `note` spells the verdict out once the run ends.
type ClipProps = { src: string; poster: string; active: boolean; note?: ReactNode; loop?: boolean; onEnded?: () => void };

export function Clip({ src, poster, active, note, loop, onEnded }: ClipProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [ended, setEnded] = useState(false);

  // In a loop, hold the verdict long enough to read, then play the run again.
  useEffect(() => {
    if (!loop || !ended) return;
    const t = setTimeout(() => {
      setEnded(false);
      const v = video.current;
      if (v) {
        v.currentTime = 0;
        v.play().catch(() => {});
      }
    }, 5000);
    return () => clearTimeout(t);
  }, [loop, ended]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (active) {
      setEnded(false);
      v.currentTime = 0;
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [active]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-ink/15 bg-[#f5efe6] shadow-[0_18px_40px_-24px_rgba(22,20,15,0.35)]">
      {/* The Chrome Kane drove, at the address the workflow serves the store on. */}
      <div className="flex items-center gap-3 border-b border-ink/10 bg-card px-3 py-2">
        <span aria-hidden className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-ink/15" />
          <span className="size-2.5 rounded-full bg-ink/15" />
          <span className="size-2.5 rounded-full bg-ink/15" />
        </span>
        <span className="min-w-0 flex-1 truncate rounded-md bg-paper px-3 py-1 text-center font-mono text-[12px] text-muted">
          localhost:4173
        </span>
        <span aria-hidden className="w-[42px]" />
      </div>
      <div className="aspect-video overflow-hidden">
        <video
          ref={video}
          src={src}
          poster={poster}
          muted
          playsInline
          preload="metadata"
          onEnded={() => {
            setEnded(true);
            onEnded?.();
          }}
          className="h-full w-full"
        />
      </div>
      {note && (
        <div
          className={`bg-ink px-4 py-3 text-[14px] leading-snug text-paper transition-opacity duration-700 sm:absolute sm:bottom-4 sm:left-4 sm:max-w-sm sm:rounded-lg sm:bg-ink/90 ${
            ended ? "opacity-100" : "opacity-0 sm:pointer-events-none"
          }`}
        >
          {note}
        </div>
      )}
    </div>
  );
}

// Proofed's real comment on PR #2. The visitor ticks the box, as the PR's author did at 08:26; the comment
// is then edited in place to the passing report, as the real one was at 08:30. Four and a half minutes,
// told here in a few seconds.
type TickState = "waiting" | "fixing" | "passed";

function Tick({ onPassed }: { onPassed: () => void }) {
  const [state, setState] = useState<TickState>("waiting");
  useEffect(() => {
    if (state !== "fixing") return;
    const t = setTimeout(() => {
      setState("passed");
      onPassed();
    }, 2600);
    return () => clearTimeout(t);
  }, [state, onPassed]);
  const ticked = state !== "waiting";

  return (
    <div className="rounded-xl border border-line bg-card">
      <p className="border-b border-line px-5 py-3 text-[14px] text-muted">
        <strong className="font-semibold text-ink">github-actions</strong> commented on PR #2 at 08:25
        {state === "passed" && <span> · edited 08:30</span>}
      </p>
      <div className="space-y-4 px-5 py-5 text-[15px] leading-relaxed">
        <p className="font-serif text-2xl">Proofed</p>
        <div className="grid">
          <div
            className={`col-start-1 row-start-1 space-y-4 transition-opacity duration-500 ${state === "passed" ? "pointer-events-none opacity-0" : ""}`}
            aria-hidden={state === "passed"}
          >
            <p>
              <strong>2 of 3</strong> scenarios broke on this PR.
            </p>
            <p className="border-l-2 border-fail/40 pl-3 text-fail">
              ✗ Free shipping from €50: Checkpoint assertion failed: "shipping is €4.90 and the total is €49.40"
            </p>
          </div>
          <div
            className={`col-start-1 row-start-1 space-y-4 transition-opacity duration-500 ${state === "passed" ? "" : "pointer-events-none opacity-0"}`}
            aria-hidden={state !== "passed"}
          >
            <p>All 3 affected scenarios pass in a real browser.</p>
            <p className="border-l-2 border-pass/40 pl-3 text-pass">
              ✓ Claude fixed it in <span className="font-mono text-[0.9em]">84514db</span> after 1 attempt.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={ticked}
          onClick={() => setState("fixing")}
          className="flex w-full items-start gap-3 rounded-lg bg-paper p-3 text-left transition-colors enabled:cursor-pointer enabled:hover:bg-line/50"
        >
          <span
            aria-hidden
            className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded border transition-colors duration-300 ${
              ticked ? "border-ink bg-ink text-paper" : "tick-hint border-ink/60 bg-white"
            }`}
          >
            <svg viewBox="0 0 16 16" className={`size-3.5 transition-opacity duration-300 ${ticked ? "opacity-100" : "opacity-0"}`}>
              <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span>
            <strong>Fix with Claude</strong>
            {state === "fixing" ? (
              <span className="text-muted"> — Claude Code is fixing it on this branch, then Proofed runs it again…</span>
            ) : (
              <> — Claude Code gets the failure, the steps and the diff, pushes a fix to this branch, and Proofed checks again.</>
            )}
          </span>
        </button>
      </div>
    </div>
  );
}

// What the stage shows, and how the replay moves on from it: `next` is called when the step has said its piece.
type StageProps = { active: boolean; next: () => void };
type Step = { time: string; title: string; tone?: "fail" | "pass"; body: ReactNode; stage: (p: StageProps) => ReactNode };

// The times are the real ones on PR #2, 13 November (UTC).
const steps: Step[] = [
  {
    time: "08:23",
    title: "A one-line tidy-up",
    body: (
      <>
        PR #2 writes the free shipping threshold as <code className="font-mono text-[0.9em]">50</code> so it reads as euros.
        The rest of the store still counts cents, so every bag now ships free.
      </>
    ),
    stage: ({ active, next }) => (
      <After active={active} ms={6500} next={next}>
        {/* The PR as it was opened: its real title, branch and size. */}
        <div className="mb-4 rounded-xl border border-line bg-card px-5 py-4">
          <p className="font-serif text-2xl leading-snug">
            Make the free shipping threshold easier to read <span className="text-muted">#2</span>
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-muted">
            <span className="rounded-full bg-pass px-2.5 py-0.5 text-[12.5px] font-medium text-paper">Open</span>
            <span className="font-mono text-[13px]">readable-shipping-threshold</span>
            <span>opened at 08:23</span>
            <span>
              <span className="text-pass">+1</span> <span className="text-fail">−1</span>
            </span>
          </p>
        </div>
        <Diff
          commit="886a15c · 08:23"
          lines={[
            { sign: " ", text: "export const SHIPPING_FEE = 490;" },
            { sign: "-", text: "export const FREE_SHIPPING_FROM = 5000;" },
            { sign: "+", text: "export const FREE_SHIPPING_FROM = 50; // €50" },
          ]}
        />
      </After>
    ),
  },
  {
    time: "08:25",
    title: "Proofed goes shopping",
    tone: "fail",
    body: (
      <>
        Proofed sees <code className="font-mono text-[0.9em]">pricing.ts</code> in the diff and runs the three scenarios that
        depend on it, each in its own Chrome. It fills a €44.50 bag and expects €4.90 shipping. The bag says Free.
      </>
    ),
    stage: (p) => <FailStage {...p} />,
  },
  {
    time: "08:26",
    title: "One box to tick",
    body: (
      <>
        The recording and the verdict land in a single comment on the PR. Tick <strong>Fix with Claude</strong>, and Claude Code
        gets the failure, the steps and the diff. Go on, tick it.
      </>
    ),
    stage: ({ next }) => <Tick onPassed={next} />,
  },
  {
    time: "08:30",
    title: "Fixed, then watched",
    tone: "pass",
    body: (
      <>
        Claude writes <code className="font-mono text-[0.9em]">50 * 100</code> and keeps the readable number. Proofed rebuilds the
        store and runs the broken scenarios again before anything is pushed. Four and a half minutes after the tick, the
        check is green.
      </>
    ),
    stage: ({ active }) => (
      <div className="space-y-4">
        <Diff
          commit="84514db · 08:29"
          lines={[
            { sign: "-", text: "export const FREE_SHIPPING_FROM = 50; // €50" },
            { sign: "+", text: "export const FREE_SHIPPING_FROM = 50 * 100; // €50, in cents" },
          ]}
        />
        <Clip src="/clips/fixed.mp4" poster="/clips/fixed.jpg" active={active} />
        <Status pass>3 scenarios pass in Chrome</Status>
      </div>
    ),
  },
];

// Kane's failing run. Once it ends and its verdict has been up a while, the replay moves on.
function FailStage({ active, next }: StageProps) {
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    if (!active) setEnded(false);
  }, [active]);
  return (
    <After active={active && ended} ms={4500} next={next}>
      <div className="space-y-4">
        <Clip
          src="/clips/fail.mp4"
          poster="/clips/fail.jpg"
          active={active}
          onEnded={() => setEnded(true)}
          note={
            <>
              Expected shipping €4.90 and a total of €49.40. <span className="text-[#ff9b8f]">The bag shows Free and €44.50.</span>
            </>
          }
        />
        <Status pass={false}>2 of 3 broke: Place an order, Free shipping from €50</Status>
      </div>
    </After>
  );
}

// Shows its children, and moves the replay on after `ms` on screen.
function After({ active, ms, next, children }: StageProps & { ms: number; children: ReactNode }) {
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(next, ms);
    return () => clearTimeout(t);
  }, [active, ms, next]);
  return <>{children}</>;
}

// One stage beside the timeline on desktop, the active step's stage inside the timeline on phones: never both,
// so no clip plays unseen.
function useDesktop() {
  const query = "(min-width: 1024px)";
  const [desktop, setDesktop] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setDesktop(mq.matches);
    mq.addEventListener("change", on);
    // The width can change between the first render and this subscription (a tab opened in the background).
    on();
    return () => mq.removeEventListener("change", on);
  }, []);
  return desktop;
}

// The PR's conversation, replayed: a timeline of what happened when, and a stage that shows it. It plays on by
// itself while on screen, and waits at the comment for the visitor to tick the box, as the PR's author did.
export function Replay() {
  const desktop = useDesktop();
  const [active, setActive] = useState(0);
  const [visible, setVisible] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const observer = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { threshold: 0.35 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const next = useCallback(() => setActive((a) => Math.min(a + 1, steps.length - 1)), []);
  const stage = (i: number) => steps[i]!.stage({ active: visible && active === i, next: active === i ? next : noop });

  return (
    <section id="replay" className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <h2 className="max-w-2xl font-serif text-4xl leading-tight sm:text-6xl">PR #2, as it happened.</h2>
        <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink/80">
          A real pull request on our demo coffee shop. Every clip here is an actual run, recorded by Proofed.{" "}
          <a href={PR_URL} className="text-ink underline underline-offset-4">
            Open it on GitHub
          </a>
          .
        </p>
      </div>

      <div className="mx-auto mt-12 max-w-7xl px-4 sm:px-8 lg:mt-16">
        <div
          ref={panel}
          className="rounded-[2rem] border border-ink/10 bg-card p-5 sm:p-8 lg:grid lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-12 lg:p-10"
        >
          <ol>
            {steps.map((s, i) => {
              const on = active === i;
              const dot =
                i < active
                  ? s.tone === "fail"
                    ? "border-fail bg-fail"
                    : "border-ink bg-ink"
                  : on
                    ? s.tone === "fail"
                      ? "border-fail bg-fail-bg"
                      : s.tone === "pass"
                        ? "border-pass bg-pass-bg"
                        : "border-ink bg-card"
                    : "border-ink/25 bg-card";
              return (
                <li key={s.title} className="relative pl-9">
                  {/* The thread between events, as on a GitHub pull request. */}
                  {i < steps.length - 1 && <span aria-hidden className="absolute bottom-0 left-[7px] top-7 w-px bg-ink/15" />}
                  <span aria-hidden className={`absolute left-0 top-[22px] size-[15px] rounded-full border-2 transition-colors duration-500 ${dot}`} />
                  <button
                    type="button"
                    onClick={() => setActive(i)}
                    aria-current={on ? "step" : undefined}
                    className="block w-full cursor-pointer py-4 text-left"
                  >
                    <span className="block font-mono text-[13px] text-muted">{s.time}</span>
                    <span
                      className={`mt-0.5 block font-serif text-[1.7rem] leading-tight transition-colors duration-500 ${on ? "" : "text-ink/45 hover:text-ink/70"}`}
                    >
                      {s.title}
                    </span>
                  </button>
                  <div className={`grid transition-[grid-template-rows] duration-500 ease-out ${on ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
                    <div className="overflow-hidden">
                      <p className="max-w-md pb-5 leading-relaxed text-ink/85">{s.body}</p>
                      {i === steps.length - 1 && (
                        <p className="-mt-1 pb-5 text-[15px]">
                          <a href={FIX_URL} className="underline underline-offset-4">
                            The fix commit, written by Claude
                          </a>
                        </p>
                      )}
                    </div>
                  </div>
                  {/* On a phone the stage sits under its step, at the panel's full width. */}
                  {!desktop && on && <div className="-ml-9 pb-6">{stage(i)}</div>}
                </li>
              );
            })}
          </ol>

          {desktop && (
            <div className="grid items-center rounded-[1.5rem] bg-paper p-8">
              {steps.map((s, i) => (
                <div
                  key={s.title}
                  aria-hidden={active !== i}
                  className={`col-start-1 row-start-1 transition-all duration-700 ease-[cubic-bezier(.2,.8,.2,1)] ${
                    active === i ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
                  }`}
                >
                  {stage(i)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const noop = () => {};
