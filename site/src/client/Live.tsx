import { useEffect, useRef, useState } from "react";
import type { Live, LiveScenario } from "../../../src/report/livefile";
import type { LiveView } from "../worker/live";
import { modelLabel, providerLabel, providerOf } from "../worker/models";
import { useLoad } from "./lib";
import { focus, link, Mark, panel, plain, soft, type Kind } from "./ui";

type Frame = LiveView["frames"][string];

// Ticks every second, for the clock and a frame's age.
function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const kindOf = (s: LiveScenario): Kind => s.status;

// What the run is doing, in one line, and the line under it.
function headline(live: Live): [string, string] {
  const fix = live.fix;
  if (live.kind === "fix" && fix) {
    const provider = providerLabel(providerOf(fix.model));
    const attempt = `Attempt ${fix.attempt} of ${fix.of} · ${modelLabel(fix.model)}${fix.effort ? `, ${fix.effort} effort` : ""}`;
    if (fix.doing === "writing") return [`${provider} is writing a fix`, `${attempt}. It has Kane's steps, what went wrong and the diff.`];
    if (fix.doing === "building") return [`Building the app with ${provider}'s change`, attempt];
    if (fix.doing === "pushing") return ["Kane saw it pass. Pushing the fix", attempt];
    return [`Kane is checking ${provider}'s fix`, `${attempt}. Nothing is pushed until it passes.`];
  }
  const done = live.scenarios.filter((s) => s.status !== "waiting" && s.status !== "running").length;
  const total = live.scenarios.length;
  if (total > 0 && done === total) return ["Kane is done. Posting the report", "The clips go up and the comment on GitHub is updated."];
  const what = total === 1 ? live.scenarios[0]!.name : `${total} scenarios`;
  const sub = done > 0 ? `${done} of ${total} done` : "Running on the scenarios’ configured targets";
  return [`Kane is checking ${what}`, sub];
}

// The clip's cursor (src/targets/clip.ts), its tip on the point where Kane clicked or typed. It glides from
// one point to the next as the clip's does; a cursor that wasn't on the last frame appears in place,
// and one that isn't on this frame fades out where it was.
function Cursor({ at, gone }: { at: NonNullable<Frame["cursor"]>; gone?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 34"
      aria-hidden
      className={`pointer-events-none absolute w-[max(15px,2.2%)] -translate-x-[8.33%] -translate-y-[5.88%] drop-shadow-[0_2px_3px_rgba(0,0,0,0.35)] transition-[left,top,opacity] duration-600 ease-[cubic-bezier(0.65,0,0.35,1)] starting:opacity-0 motion-reduce:transition-none ${gone ? "opacity-0" : ""}`}
      style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
    >
      <path d="M2 2v25.5l6.4-6.2 4.1 9.9 4.4-1.8-4-9.7h8.9z" fill="#0b0d12" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

// What Kane's Chrome shows, swapped in only once the next frame has loaded, so it never blinks.
// A frame that fails to load is skipped: the last good one (or the caption) stays, never a broken image.
// The cursor comes with its frame and changes with it, never ahead of the picture or behind it.
// A frame without one keeps the last, `gone`, so it can fade out; one that comes back gets a new
// key (n), so it appears at its point instead of gliding there from where the old one faded.
type Shown = { url: string; aspect: number; cursor?: NonNullable<Frame["cursor"]> & { n: number }; gone?: boolean };

function nextShown(last: Shown | undefined, url: string, aspect: number, at: Frame["cursor"]): Shown {
  const c = last?.cursor;
  if (!at) return { url, aspect, ...(c && { cursor: c, gone: true }) };
  return { url, aspect, cursor: { ...at, n: c && !last.gone ? c.n : (c?.n ?? 0) + 1 } };
}

function LiveFrame({ frame, on, now, startedAt }: { frame: Frame | undefined; on: boolean; now: number; startedAt?: number }) {
  const [shown, setShown] = useState<Shown>();
  useEffect(() => {
    if (!frame || frame.url === shown?.url) return;
    let current = true;
    const img = new Image();
    img.src = frame.url;
    img.decode().then(
      () => current && setShown((last) => nextShown(last, frame.url, img.naturalWidth / img.naturalHeight, frame.cursor)),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [frame?.url, shown?.url]);
  const age = frame ? now - frame.at : 0;
  return (
    <figure className="min-w-0 overflow-hidden rounded-lg border border-edge bg-bg lg:sticky lg:top-6">
      <div className="relative aspect-video overflow-hidden bg-black">
        {shown ? (
          // Covers the 16:9 box the way object-cover with the top kept would: full width and cut at the
          // bottom, or full height and cut on both sides. The cursor's fractions then land on the picture.
          <div className="absolute top-0 left-1/2 -translate-x-1/2" style={{ aspectRatio: shown.aspect, width: `max(100%, ${(shown.aspect / (16 / 9)) * 100}%)` }}>
            <img src={shown.url} alt="Latest live frame" className="block size-full" />
            {shown.cursor && <Cursor key={shown.cursor.n} at={shown.cursor} gone={shown.gone} />}
          </div>
        ) : (
          <figcaption className="grid size-full place-items-center bg-bg px-6 text-center text-[13px] text-faint">Live frames appear here when available.</figcaption>
        )}
      </div>
      {/* A live stream's bar, under the picture as the recording's controls are: always at the end. */}
      <div className="flex h-11 items-center gap-3 border-t border-edge px-3">
        <span className={`inline-flex shrink-0 items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide ${on ? "text-fg" : "text-faint"}`}>
          <span className={`size-2 rounded-full ${on ? "animate-pulse bg-bad" : "bg-faint"}`} />
          Live
        </span>
        <span className="relative h-1 min-w-0 flex-1 rounded-full bg-edge">
          <span className={`absolute inset-y-0 left-0 w-full rounded-full ${on ? "bg-bad" : "bg-faint"}`} />
        </span>
        <span className="shrink-0 text-[12px] tabular-nums text-faint">
          {on && shown && age > 8000 ? `${Math.round(age / 1000)} s behind` : startedAt ? clock(now - startedAt) : ""}
        </span>
      </div>
    </figure>
  );
}

// Kane's steps as they come: the one it's on turns, the rest are done or broke.
function LiveSteps({ scenario }: { scenario: LiveScenario }) {
  if (scenario.status === "waiting") return <p className="text-dim">Waiting for this scenario to start.</p>;
  if (scenario.steps.length === 0) return <p className="text-dim">Kane is starting the check.</p>;
  const shown = scenario.steps.flatMap((step, i) => {
    // Kane doesn't always say a step ended before it starts the next: only the last one can be going.
    const running = step.status === "running" && i === scenario.steps.length - 1;
    // Until Kane says what the step is, its remark is a stand-in like "Step 5".
    const said = step.remark && !/^step \d+$/i.test(step.remark) ? plain(step.remark) : undefined;
    // A step Kane left behind without a word has nothing to show.
    return said || running || step.status === "failed" ? [{ step, said, running }] : [];
  });
  return (
    <ol className="-mx-3">
      {/* Numbered by position: Kane's own numbers start at 2 (its first step opens the page unannounced). */}
      {shown.map(({ step, said, running }, i) => {
        const failed = step.status === "failed";
        return (
          <li
            key={step.n}
            aria-current={running ? "step" : undefined}
            className={`flex gap-3 rounded-md px-3 py-1.5 transition-[opacity,color,background-color] duration-300 starting:opacity-0 ${failed ? "bg-bad-bg text-fg" : running ? "text-fg" : "text-dim"}`}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-end">
              {failed ? <Mark kind="failed" /> : <span className="font-mono text-[12px] tabular-nums text-faint">{i + 1}</span>}
            </span>
            {/* The step Kane is on shimmers, as an agent's "Thinking" does. */}
            <span className={`min-w-0 ${running ? "shimmer" : ""}`}>{said ?? (running ? "Thinking…" : "…")}</span>
          </li>
        );
      })}
    </ol>
  );
}

// The run on this pull request as it goes (src/report/live.ts in the action): what Kane or Claude is doing
// now, Kane's steps as they happen and a frame of its Chrome every couple of seconds.
export function LiveRun({ repo, pr }: { repo: string; pr: number }) {
  const [load] = useLoad<LiveView>(`/api/pulls/${repo}/${pr}/live`, 1500);
  const now = useNow();
  const [picked, setPicked] = useState<string>();
  // The last state seen stays up after the run ends, until the report it posts takes over the page.
  const last = useRef<LiveView>(undefined);
  if (load.status === "ok" && load.data.live) last.current = load.data;
  const view = last.current;
  const live = view?.live;

  if (!live) {
    return (
      <section className={`${panel} px-4 py-4 sm:px-6`}>
        <p className="font-medium">Waiting for GitHub Actions to start the run</p>
        <p className="mt-1 text-[13px] text-dim">Kane's steps and available live frames appear here as it works.</p>
      </section>
    );
  }

  const [title, sub] = headline(live);
  const doing = live.fix?.doing;
  const browser = !(live.kind === "fix" && (doing === "writing" || doing === "building" || doing === "pushing"));
  // Follow the scenario Kane is on, unless one was picked.
  const current =
    live.scenarios.find((s) => s.id === picked) ??
    live.scenarios.find((s) => s.status === "running") ??
    live.scenarios.find((s) => s.status === "failed") ??
    live.scenarios[0];

  return (
    <section className={panel}>
      <header className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-4 sm:px-6">
        <div className="min-w-0 flex-1 basis-64">
          <p className="font-medium">{title}</p>
          <p className="mt-1 text-[13px] text-dim">{sub}</p>
        </div>
        <p className="flex items-center gap-1.5 text-[13px] text-faint">
          <span className="tabular-nums">{clock(now - live.startedAt)}</span>
          {live.runUrl && (
            <>
              <span aria-hidden>·</span>
              <a href={live.runUrl} target="_blank" rel="noreferrer" className={`${link} hover:text-fg`}>
                Logs
              </a>
            </>
          )}
        </p>
      </header>

      {live.fix && live.fix.tries.length > 0 && (
        <ol className="space-y-1 px-4 pb-4 text-[13px] text-dim sm:px-6">
          {live.fix.tries.map((t, i) => (
            <li key={i}>
              <span className="text-faint">Attempt {i + 1}:</span> {t.summary} <span className="text-fg">{t.result}</span>
            </li>
          ))}
        </ol>
      )}

      {browser && current && (
        <>
          {live.scenarios.length > 1 && (
            <div role="tablist" aria-label="Scenarios in this run" className="flex overflow-x-auto overflow-y-hidden border-y border-edge px-2 [scrollbar-width:none] sm:px-3">
              {live.scenarios.map((s) => {
                const on = s.id === current.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setPicked(s.id)}
                    className={`-mb-px flex h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 ${soft} ${focus} focus-visible:ring-inset ${on ? "border-fg font-medium text-fg" : "border-transparent text-dim hover:text-fg"}`}
                  >
                    <Mark kind={kindOf(s)} /> {s.name}
                  </button>
                );
              })}
            </div>
          )}
          <div className={`grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8 ${live.scenarios.length > 1 ? "" : "border-t border-edge"}`}>
            <div className="min-w-0 lg:col-start-2 lg:row-start-1">
              <LiveFrame key={current.id} frame={view.frames[current.id]} on={current.status === "running"} now={now} startedAt={current.startedAt} />
            </div>
            <div className="min-w-0 lg:col-start-1 lg:row-start-1">
              <LiveSteps scenario={current} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
