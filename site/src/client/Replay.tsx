// The central piece of the landing: PR #2 of the demo store, replayed step by step.
// Everything shown here happened on that PR: the diff, Kane's recordings, the fix commit.
import { useEffect, useRef, useState, type ReactNode } from "react";

const PR_URL = "https://github.com/t1dem/proofed-demo-store/pull/2";
const FIX_URL = "https://github.com/t1dem/proofed-demo-store/commit/84514dbd32279572679948eb3baa665756740ba7";

type DiffLine = { sign: "+" | "-" | " "; text: string };

function Diff({ lines }: { lines: DiffLine[] }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-line bg-card">
      <figcaption className="border-b border-line px-4 py-2.5 font-mono text-[13px] text-muted">src/pricing.ts</figcaption>
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
type ClipProps = { src: string; poster: string; active: boolean; note?: ReactNode; loop?: boolean };

export function Clip({ src, poster, active, note, loop }: ClipProps) {
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
    <div className="relative overflow-hidden rounded-xl border border-line bg-[#f5efe6]">
      <div className="aspect-video overflow-hidden">
        <video
          ref={video}
          src={src}
          poster={poster}
          muted
          playsInline
          preload="metadata"
          onEnded={() => setEnded(true)}
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

function Tick({ active }: { active: boolean }) {
  const [ticked, setTicked] = useState(false);
  useEffect(() => {
    if (!active) return setTicked(false);
    const t = setTimeout(() => setTicked(true), 900);
    return () => clearTimeout(t);
  }, [active]);

  return (
    <div className="rounded-xl border border-line bg-card">
      <p className="border-b border-line px-5 py-3 text-[14px] text-muted">
        <strong className="font-semibold text-ink">github-actions</strong> commented on PR #2
      </p>
      <div className="space-y-4 px-5 py-5 text-[15px] leading-relaxed">
        <p className="font-serif text-2xl">Proofed</p>
        <p>
          <strong>2 of 3</strong> scenarios broke on this PR.
        </p>
        <p className="border-l-2 border-line pl-3 text-muted">
          ✗ Free shipping from €50: Checkpoint assertion failed: "shipping is €4.90 and the total is €49.40"
        </p>
        <label className="flex items-start gap-3 rounded-lg bg-paper p-3">
          <span
            aria-hidden
            className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded border transition-colors duration-300 ${
              ticked ? "border-ink bg-ink text-paper" : "border-muted bg-white"
            }`}
          >
            <svg viewBox="0 0 16 16" className={`size-3.5 transition-opacity duration-300 ${ticked ? "opacity-100" : "opacity-0"}`}>
              <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span>
            <strong>Fix with Claude</strong> — Claude Code gets the failure, the steps and the diff, pushes a fix to this branch, and
            Proofed checks again.
          </span>
        </label>
      </div>
    </div>
  );
}

type Step = { title: string; body: ReactNode; stage: (active: boolean) => ReactNode };

const steps: Step[] = [
  {
    title: "A one-line tidy-up",
    body: (
      <>
        PR #2 writes the free shipping threshold as <code className="font-mono text-[0.9em]">50</code> so it reads as euros.
        The rest of the store still counts cents, so every bag now ships free.
      </>
    ),
    stage: () => (
      <Diff
        lines={[
          { sign: " ", text: "export const SHIPPING_FEE = 490;" },
          { sign: "-", text: "export const FREE_SHIPPING_FROM = 5000;" },
          { sign: "+", text: "export const FREE_SHIPPING_FROM = 50; // €50" },
        ]}
      />
    ),
  },
  {
    title: "Kane goes shopping",
    body: (
      <>
        Proofed sees <code className="font-mono text-[0.9em]">pricing.ts</code> in the diff and runs the three scenarios that
        depend on it, each in its own Chrome. Kane fills a €44.50 bag and expects €4.90 shipping. The bag says Free.
      </>
    ),
    stage: (active) => (
      <div className="space-y-4">
        <Clip
          src="/clips/fail.mp4"
          poster="/clips/fail.jpg"
          active={active}
          note={
            <>
              Kane expected shipping €4.90 and a total of €49.40. <span className="text-[#ff9b8f]">The bag shows Free and €44.50.</span>
            </>
          }
        />
        <Status pass={false}>2 of 3 broke: Place an order, Free shipping from €50</Status>
      </div>
    ),
  },
  {
    title: "One box to tick",
    body: (
      <>
        The recording and Kane's verdict land in a single comment on the PR. Tick <strong>Fix with Claude</strong>, and Claude
        Code gets the failure, Kane's steps and the diff.
      </>
    ),
    stage: (active) => <Tick active={active} />,
  },
  {
    title: "Fixed, then watched",
    body: (
      <>
        Claude writes <code className="font-mono text-[0.9em]">50 * 100</code> and keeps the readable number. Proofed rebuilds the
        store and Kane runs the broken scenarios again before anything is pushed. Four and a half minutes after the tick, the
        check is green.
      </>
    ),
    stage: (active) => (
      <div className="space-y-4">
        <Diff
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

// One stage per step on phones, one sticky stage on desktop: never both, so no clip plays unseen.
function useDesktop() {
  const query = "(min-width: 1024px)";
  const [desktop, setDesktop] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setDesktop(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desktop;
}

export function Replay() {
  const desktop = useDesktop();
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <section id="replay" className="border-t border-line py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-8">
        <h2 className="max-w-2xl font-serif text-4xl leading-tight sm:text-5xl">PR #2, as it happened.</h2>
        <p className="mt-4 max-w-xl text-muted">
          A real pull request on our demo coffee shop. Every clip below is Kane's own run, recorded by Proofed.{" "}
          <a href={PR_URL} className="text-ink underline underline-offset-4">
            Open it on GitHub
          </a>
          .
        </p>

        <div className="mt-12 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <ol>
            {steps.map((s, i) => (
              <li
                key={s.title}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                data-step={i}
                className="py-10 lg:flex lg:min-h-[75vh] lg:flex-col lg:justify-center lg:py-0"
              >
                <h3 className={`font-serif text-3xl transition-colors duration-500 ${desktop && active !== i ? "text-ink/40" : ""}`}>
                  {s.title}
                </h3>
                <p className="mt-3 max-w-md leading-relaxed text-ink/85">{s.body}</p>
                {i === steps.length - 1 && (
                  <p className="mt-4 text-[15px]">
                    <a href={FIX_URL} className="underline underline-offset-4">
                      The fix commit, written by Claude
                    </a>
                  </p>
                )}
                {!desktop && <div className="mt-6">{s.stage(active === i)}</div>}
              </li>
            ))}
          </ol>

          {desktop && (
          <div>
            <div className="sticky top-[12vh] grid h-[76vh] items-center">
              {steps.map((s, i) => (
                <div
                  key={s.title}
                  aria-hidden={active !== i}
                  className={`col-start-1 row-start-1 transition-all duration-700 ease-[cubic-bezier(.2,.8,.2,1)] ${
                    active === i ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
                  }`}
                >
                  {s.stage(active === i)}
                </div>
              ))}
            </div>
          </div>
          )}
        </div>
      </div>
    </section>
  );
}
