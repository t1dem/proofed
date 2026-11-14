import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Live, LiveScenario } from "../../../src/livefile";
import type { LiveView } from "../worker/live";
import { modelLabel } from "../worker/models";
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
    const attempt = `Attempt ${fix.attempt} of ${fix.of} · ${modelLabel(fix.model)}${fix.effort ? `, ${fix.effort} effort` : ""}`;
    if (fix.doing === "writing") return ["Claude is writing a fix", `${attempt}. It has Kane's steps, what went wrong and the diff.`];
    if (fix.doing === "building") return ["Building the app with Claude's change", attempt];
    if (fix.doing === "pushing") return ["Kane saw it pass. Pushing the fix", attempt];
    return ["Kane is checking Claude's fix", `${attempt}. Nothing is pushed until it passes.`];
  }
  const done = live.scenarios.filter((s) => s.status !== "waiting" && s.status !== "running").length;
  const total = live.scenarios.length;
  if (total > 0 && done === total) return ["Kane is done. Posting the report", "The clips go up and the comment on GitHub is updated."];
  const what = total === 1 ? live.scenarios[0]!.name : `${total} scenarios`;
  const sub = done > 0 ? `${done} of ${total} done` : total > 3 ? "Three at a time, each in its own Chrome" : total > 1 ? "Side by side, each in its own Chrome" : "In a real Chrome";
  return [`Kane is checking ${what}`, sub];
}

// What Kane's Chrome shows, swapped in only once the next frame has loaded, so it never blinks.
// A frame that fails to load is skipped: the last good one (or the caption) stays, never a broken image.
function LiveFrame({ frame, on, now }: { frame: Frame | undefined; on: boolean; now: number }) {
  const [shown, setShown] = useState<string>();
  useEffect(() => {
    const next = frame?.url;
    if (!next || next === shown) return;
    let current = true;
    const img = new Image();
    img.src = next;
    img.decode().then(
      () => current && setShown(next),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [frame?.url, shown]);
  const age = frame ? now - frame.at : 0;
  const chip = "pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[12px] font-medium text-white";
  return (
    <figure className="relative aspect-video min-w-0 overflow-hidden rounded-lg border border-edge bg-bg lg:sticky lg:top-6">
      {shown ? (
        <img src={shown} alt="What Kane's Chrome shows now" className="block size-full object-cover object-top" />
      ) : (
        <figcaption className="grid size-full place-items-center px-6 text-center text-[13px] text-faint">Kane's Chrome shows here once it opens the page.</figcaption>
      )}
      {shown && on && (
        <span className={chip}>
          <span className="size-1.5 animate-pulse rounded-full bg-bad" />
          {age > 8000 ? `Live · ${Math.round(age / 1000)} s ago` : "Live"}
        </span>
      )}
    </figure>
  );
}

// Kane's steps as they come: the one it's on turns, the rest are done or broke.
function LiveSteps({ scenario }: { scenario: LiveScenario }) {
  if (scenario.status === "waiting") return <p className="text-dim">Waiting for a free Chrome. Kane runs three scenarios at a time.</p>;
  if (scenario.steps.length === 0) return <p className="text-dim">Kane is opening the page.</p>;
  return (
    <ol className="-mx-3">
      {/* Numbered by position: Kane's own numbers start at 2 (its first step opens the page unannounced). */}
      {scenario.steps.map((step, i) => {
        const running = step.status === "running";
        const failed = step.status === "failed";
        return (
          <li
            key={step.n}
            className={`flex gap-3 rounded-md px-3 py-1.5 transition-[opacity,color,background-color] duration-300 starting:opacity-0 ${failed ? "bg-bad-bg text-fg" : running ? "text-fg" : "text-dim"}`}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-end">
              {failed ? (
                <Mark kind="failed" />
              ) : running ? (
                <LoaderCircle size={14} className="animate-spin text-busy" aria-label="Kane is on this step" />
              ) : (
                <span className="font-mono text-[12px] tabular-nums text-faint">{i + 1}</span>
              )}
            </span>
            <span className="min-w-0">{step.remark ? plain(step.remark) : "…"}</span>
          </li>
        );
      })}
    </ol>
  );
}

// The run on this pull request as it goes (src/live.ts in the action): what Kane or Claude is doing
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
        <p className="mt-1 text-[13px] text-dim">Kane's steps and what its Chrome shows appear here as it works.</p>
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
              <LiveFrame key={current.id} frame={view.frames[current.id]} on={current.status === "running"} now={now} />
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
