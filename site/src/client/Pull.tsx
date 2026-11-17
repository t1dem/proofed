import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeftRight, Maximize, Minimize, Pause, Play, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { modelLabel, providerLabel, providerOf } from "../worker/models";
import type { PullDetail, PullView, Run, RunScenario } from "../worker/runs";
import { ago, fixerName, movingName, titleName, useLoad, type Ask, type Route, type useAsk } from "./lib";
import { LiveRun } from "./Live";
import { creditSummary, defaultScenario, fixedSummary, latestScenarios, scenarioStory as story } from "../run-summary";
import { Backdrop, bone, focus, iconButton, kindOf, Link, link, Mark, marks, MobileBar, NEEDS_WRITE, outline, PageTitle, panel, popover, useSheetDrag, plain, Segmented, sha7, soft, solid, useDismiss } from "./ui";

type Seen = { run: Run; scenario: RunScenario };

function verdict({ outcome, reason, suggestion }: RunScenario) {
  if (outcome === "passed") return reason || "Passes.";
  if (outcome === "unsure") return [reason, suggestion].filter(Boolean).join(" ") || "The check was not confirmed.";
  return reason || (outcome === "error" ? "Kane couldn't finish this run." : "Broke.");
}

type Step = NonNullable<RunScenario["steps"]>[number];
// Play the clip from `at`; `n` makes a second click on the same step a new request.
type Seek = { at: number; n: number };

const clock = (seconds = 0) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

// The recording with its own controls. Its track marks where each of Kane's steps starts (the
// broken one in red), so a step leads to its moment in the clip and the clip lights up its step.
// Until it plays, the poster is the still: what the run ended on.
function Recording({ clip, steps, seek, onTime }: { clip: NonNullable<RunScenario["clip"]>; steps?: Step[]; seek?: Seek; onTime?: (t: number) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);
  const [length, setLength] = useState<number>();
  const [time, setTime] = useState(0);
  const still = clip.jpg ?? clip.gif;
  const box = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);

  const playFrom = (at?: number) => {
    const v = video.current;
    if (!v) return;
    if (at !== undefined) v.currentTime = at;
    else if (v.ended) v.currentTime = 0;
    v.play().catch(() => {});
  };

  const toggle = () => (video.current?.paused === false ? video.current.pause() : playFrom());

  // Full screen in this tab: the clip with its controls. An iPhone can only put a <video> itself full
  // screen, with its own controls.
  useEffect(() => {
    const sync = () => setFull(!!box.current && document.fullscreenElement === box.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) return void document.exitFullscreen();
    if (box.current?.requestFullscreen) return void box.current.requestFullscreen().catch(() => {});
    (video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null)?.webkitEnterFullscreen?.();
  };

  // A step picked below the clip.
  useEffect(() => {
    if (seek) playFrom(seek.at);
  }, [seek]);

  // The track follows every frame while playing; timeupdate alone moves it in visible jumps.
  const paint = () => {
    const v = video.current;
    if (v && fill.current && v.duration) fill.current.style.width = `${(v.currentTime / v.duration) * 100}%`;
  };
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      paint();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  // A page that crashed on load has no recording, only a screenshot of it (src/precheck.ts).
  if (!clip.mp4) {
    const screenshot = !clip.gif;
    return still ? (
      <>
        <img src={still} alt={screenshot ? "What a user sees on opening the page" : "Where Kane's run in the browser ended"} className="block w-full" />
        {screenshot && <p className="border-t border-edge px-3.5 py-2 text-[13px] text-dim">What a user sees on opening the page</p>}
      </>
    ) : null;
  }

  const timeAt = (e: PointerEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.min(Math.max((e.clientX - box.left) / box.width, 0), 1) * (length ?? 0);
  };
  const scrub = (e: PointerEvent<HTMLElement>) => {
    if (video.current && length) video.current.currentTime = timeAt(e);
  };

  return (
    <div ref={box} className={`flex flex-col bg-bg ${full ? "h-full" : ""}`}>
      <div className={`relative bg-black ${full ? "min-h-0 flex-1" : ""}`}>
        <video
          ref={video}
          src={clip.mp4}
          poster={still}
          preload="metadata"
          muted
          playsInline
          onLoadedMetadata={(e) => setLength(e.currentTarget.duration)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            const t = e.currentTarget.currentTime;
            setTime(t);
            onTime?.(t);
            paint();
          }}
          onClick={toggle}
          className={`block w-full cursor-pointer ${full ? "h-full object-contain" : "aspect-video"}`}
        />
        {!playing && (
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="grid size-14 place-items-center rounded-full bg-black/60 text-white backdrop-blur-sm">
              <Play size={22} fill="currentColor" className="ml-0.5" />
            </span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-edge px-1.5 py-1.5">
        <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"} className={iconButton}>
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>
        <div
          className="relative mx-1 h-7 min-w-0 flex-1 cursor-pointer touch-none"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            scrub(e);
          }}
          onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && scrub(e)}
        >
          <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-edge" />
          <span ref={fill} className="absolute left-0 top-1/2 h-1 w-0 -translate-y-1/2 rounded-full bg-dim" />
          {length &&
            steps?.map((step, i) =>
              step.at === undefined ? null : (
                <button
                  key={i}
                  type="button"
                  title={plain(step.remark)}
                  aria-label={`Play from step ${i + 1}: ${plain(step.remark)}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => playFrom(step.at)}
                  style={{ left: `${(step.at / length) * 100}%` }}
                  className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-panel transition-transform hover:scale-150 ${step.failed ? "bg-bad" : "bg-faint"} ${focus}`}
                />
              ),
            )}
        </div>
        <span className="shrink-0 text-[12px] tabular-nums text-faint">
          {clock(time)} / {clock(length)}
        </span>
        <button type="button" onClick={toggleFull} aria-label={full ? "Exit full screen" : "Full screen"} title={full ? "Exit full screen" : "Full screen"} className={iconButton}>
          {full ? <Minimize size={15} /> : <Maximize size={15} />}
        </button>
      </div>
    </div>
  );
}

// The broken run's last frame over the passing one's, with a handle that wipes between them.
function Compare({ before, after }: { before: string; after: string }) {
  const [x, setX] = useState(50);
  const move = (e: PointerEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setX(Math.min(Math.max(((e.clientX - box.left) / box.width) * 100, 0), 100));
  };
  const chip = "pointer-events-none absolute top-3 rounded bg-black/65 px-1.5 py-0.5 text-[12px] font-medium text-white";
  return (
    <div
      className="relative cursor-ew-resize touch-pan-y select-none overflow-hidden"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && move(e)}
    >
      <img src={after} alt="After the fix: where Kane's run ended" draggable={false} className="block aspect-video w-full object-cover" />
      <img
        src={before}
        alt="Before the fix: where Kane's run ended"
        draggable={false}
        className="absolute inset-0 size-full object-cover"
        style={{ clipPath: `inset(0 ${100 - x}% 0 0)` }}
      />
      <span className={`${chip} left-3`}>Before</span>
      <span className={`${chip} right-3`}>After</span>
      <span className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.2)]" style={{ left: `${x}%` }} />
      <span
        role="slider"
        tabIndex={0}
        aria-label="Wipe between before and after"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(x)}
        onKeyDown={(e) => {
          const by = e.key === "ArrowLeft" ? -5 : e.key === "ArrowRight" ? 5 : 0;
          if (!by) return;
          e.preventDefault();
          setX((v) => Math.min(Math.max(v + by, 0), 100));
        }}
        style={{ left: `${x}%` }}
        className={`absolute top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-black shadow-lg shadow-black/30 ${focus}`}
      >
        <ChevronsLeftRight size={16} />
      </span>
    </div>
  );
}


// Kane's steps. Where the clip knows when a step starts, the step plays the clip from there, and
// the step on screen while it plays is lit.
function Steps({ steps, current, onSeek }: { steps: Step[]; current: number; onSeek?: (at: number) => void }) {
  return (
    <ol className="-mx-3">
      {steps.map((step, i) => {
        const on = i === current;
        const at = onSeek && step.at;
        const look = `group flex w-full gap-3 rounded-md px-3 py-1.5 text-left ${soft} ${
          step.failed ? "bg-bad-bg text-fg" : on ? "bg-hover text-fg" : "text-dim"
        }`;
        const body = (
          <>
            <span className="flex h-5 w-5 shrink-0 items-center justify-end">
              {step.failed ? (
                <Mark kind="failed" />
              ) : (
                <span className={`font-mono text-[12px] tabular-nums ${on ? "text-fg" : "text-faint"} ${at !== undefined ? "group-hover:hidden" : ""}`}>{i + 1}</span>
              )}
              {at !== undefined && !step.failed && <Play size={13} className="hidden text-fg group-hover:block" />}
            </span>
            <span className="min-w-0">{plain(step.remark)}</span>
          </>
        );
        return (
          <li key={i}>
            {at !== undefined ? (
              <button type="button" onClick={() => onSeek?.(at)} title="Play from this step" className={`${look} ${focus} hover:text-fg ${step.failed ? "" : "hover:bg-hover/60"}`}>
                {body}
              </button>
            ) : (
              <div className={look}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function runLabel(run: Run, runs: Run[]) {
  const count = (outcome: RunScenario["outcome"]) => run.scenarios.filter((s) => s.outcome === outcome).length;
  if (run.fix?.status === "fixed") return fixedSummary(runs, providerLabel(providerOf(run.fix.model)));
  if (count("failed") > 0) return `${count("failed")} of ${run.scenarios.length} broke`;
  if (count("error") > 0) return "couldn't finish";
  const unsure = run.scenarios.filter((s) => s.outcome === "unsure");
  if (unsure.length > 0) return "not checked";
  return run.scenarios.length === 0 ? "nothing to run" : `${run.scenarios.length} pass`;
}

const runDot = (run: Run) =>
  run.scenarios.some((s) => s.outcome === "failed") ? "bg-bad" : run.scenarios.some((s) => s.outcome !== "passed") ? "bg-busy" : "bg-ok";

const duration = (seconds: number) => (seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`);

// The line under the title: how the shown run went and where it came from. With more than one run
// the commit opens the list of them, and picking one shows the pull request as that run left it.
// The commit Kane or Claude is at work on heads the list in their color until its run reports.
type Checking = { sha: string; at: number; kind: "running" | "fixing" };
export function RunMeta({ runs, at, onAt, checking }: { runs: Run[]; at: number; onAt: (key: string | undefined) => void; checking?: Checking }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, box);
  const sheet = useSheetDrag<HTMLSpanElement>(close);
  const run = runs[at];
  if (!run) return null;
  const seconds = Math.round(run.scenarios.reduce((sum, s) => sum + (s.seconds ?? 0), 0));
  const cost = [seconds > 0 ? duration(seconds) : undefined, creditSummary(runs.slice(at), at === 0)].filter((part): part is string => !!part);
  const when = ago(run.at) === "now" ? "just now" : `${ago(run.at)} ago`;
  const dot = <span aria-hidden>·</span>;
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-7 text-[13px] text-faint">
      <span className="text-dim">{runLabel(run, runs.slice(at))}</span>
      {dot}
      <span>{when} on</span>
      {runs.length > 1 || checking ? (
        <span ref={box} className="relative">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            title="Earlier runs"
            className={`-mx-1 inline-flex h-6 items-center gap-0.5 rounded px-1 font-mono text-[12px] text-dim ${soft} hover:bg-hover hover:text-fg ${focus}`}
          >
            {sha7(run.sha)}
            <ChevronDown size={12} />
          </button>
          {open && <Backdrop onClose={close} />}
          {open && (
            <span ref={sheet} className={`${popover} left-0 right-auto block w-[min(340px,calc(100vw-32px))] p-1 max-md:px-2`}>
              {checking && (
                <span className="flex h-8 w-full items-center gap-2.5 px-2 text-[13px] max-md:h-12 max-md:px-3 max-md:text-[15px]">
                  <span className={`size-2 shrink-0 rounded-full ${marks[checking.kind].fill}`} />
                  <span className="font-mono text-[12px] text-fg">{sha7(checking.sha)}</span>
                  <span className="min-w-0 flex-1 truncate text-dim">{marks[checking.kind].label}</span>
                  <span className="tabular-nums text-faint">{ago(checking.at)}</span>
                  <span className="w-3.5 shrink-0" />
                </span>
              )}
              {runs.map((r, i) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => {
                    onAt(i === 0 ? undefined : r.key);
                    setOpen(false);
                  }}
                  className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] ${soft} hover:bg-hover active:bg-hover max-md:h-12 max-md:px-3 max-md:text-[15px] ${focus}`}
                >
                  <span className={`size-2 shrink-0 rounded-full ${runDot(r)}`} />
                  <span className="font-mono text-[12px] text-fg">{sha7(r.sha)}</span>
                  <span className="min-w-0 flex-1 truncate text-dim">{runLabel(r, runs.slice(i))}</span>
                  <span className="tabular-nums text-faint">{ago(r.at)}</span>
                  <span className="w-3.5 shrink-0 text-fg">{i === at && <Check size={14} />}</span>
                </button>
              ))}
            </span>
          )}
        </span>
      ) : (
        <span className="font-mono text-[12px]">{sha7(run.sha)}</span>
      )}
      {cost.map((part) => (
        <span key={part} className="contents">
          {dot}
          <span>{part}</span>
        </span>
      ))}
      {run.runUrl && (
        <>
          {dot}
          <a href={run.runUrl} target="_blank" rel="noreferrer" className={`${link} hover:text-fg`}>
            Logs
          </a>
        </>
      )}
    </p>
  );
}

const Label = ({ children }: { children: ReactNode }) => <h3 className="mb-2 text-[13px] font-medium text-faint">{children}</h3>;

type Mode = "before" | "compare" | "after";

// One scenario as a run left it, in one card: what broke and why on top, in words; under it the
// recording beside Kane's steps (held in view on a wide screen while the steps scroll), so a step and
// its moment in the clip are seen together.
function ScenarioView({ now, before, fix, tabs }: { now: Seen; before: Seen | undefined; fix: Run["fix"]; tabs: ReactNode }) {
  const comparable = !!(before?.scenario.clip?.jpg && now.scenario.clip?.jpg);
  const [mode, setMode] = useState<Mode>(comparable ? "compare" : "after");
  const [seek, setSeek] = useState<Seek>();
  const [time, setTime] = useState<number>();
  const frame = useRef<HTMLElement>(null);
  const broken = before ?? now;
  const steps = broken.scenario.steps ?? [];
  const shown = before && mode === "before" ? before : now;
  const playsBroken = shown === broken && mode !== "compare";
  const current = playsBroken && time !== undefined ? steps.findLastIndex((s) => s.at !== undefined && s.at <= time + 0.05) : -1;
  const clip = shown.scenario.clip;
  const media = !!(clip || before);
  const crashed = now.scenario.outcome !== "passed" && steps.length === 0;
  const why = now.scenario.outcome !== "passed" && now.scenario.diagnosis !== now.scenario.reason ? now.scenario.diagnosis : undefined;
  const side = (crashed && !!why) || !!fix || steps.length > 0;

  const pick = (next: Mode) => {
    setMode(next);
    setSeek(undefined);
    setTime(undefined);
  };
  // On a phone the clip is above the steps: bring it into view as it starts playing.
  const playStep = (at: number) => {
    if (before) setMode("before");
    setSeek({ at, n: (seek?.n ?? 0) + 1 });
    frame.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  };

  return (
    <section className={panel}>
      {tabs}
      <div className={`px-4 pt-4 sm:px-6 sm:pt-6 ${media || side ? "" : "pb-4 sm:pb-6"}`}>
        <p className="flex gap-3 font-serif text-xl leading-7">
          <span className="flex h-7 shrink-0 items-center">
            <Mark kind={now.scenario.outcome} size={18} />
          </span>
          <span className="min-w-0">{verdict(now.scenario)}</span>
        </p>
        {before && (
          <p className="mt-2 pl-[30px] text-dim">
            <span className="text-faint">Before the fix:</span> {verdict(before.scenario)}
          </p>
        )}
        {why && !crashed && <p className="mt-2 max-w-3xl pl-[30px] text-dim">{why}</p>}
      </div>

      {(media || side) && (
        <div className={`grid gap-7 p-4 sm:p-6 ${media && side ? "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8" : ""}`}>
          {media && (
            <figure ref={frame} className="min-w-0 scroll-my-4 self-start overflow-hidden rounded-lg border border-edge bg-bg lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1">
              {before && (
                <div className="flex items-center gap-3 border-b border-edge px-2 py-2">
                  <Segmented
                    label="Which run"
                    value={mode}
                    onChange={pick}
                    options={[
                      { value: "before", label: "Before the fix" },
                      ...(comparable ? [{ value: "compare" as const, label: "Compare" }] : []),
                      { value: "after", label: "After" },
                    ]}
                  />
                </div>
              )}
              {mode === "compare" && before ? (
                <Compare before={before.scenario.clip!.jpg!} after={now.scenario.clip!.jpg!} />
              ) : (
                clip && (
                  <Recording
                    key={shown.run.key}
                    clip={clip}
                    steps={playsBroken ? steps : undefined}
                    seek={playsBroken ? seek : undefined}
                    onTime={playsBroken ? setTime : undefined}
                  />
                )
              )}
            </figure>
          )}

          {side && (
            <div className="min-w-0 space-y-7 lg:col-start-1 lg:row-start-1">
              {crashed && why && (
                <div>
                  {/* A failure without steps is a page that crashed on load: Kane never ran, the browser said this. */}
                  <Label>Browser console error</Label>
                  <p className="font-mono text-[13px] text-dim">{why}</p>
                </div>
              )}
              {fix && (
                <div>
                  <Label>What {providerLabel(providerOf(fix.model))} changed</Label>
                  {fix.summary && <p>{fix.summary}</p>}
                  {fix.files && fix.files.length > 0 && (
                    <ul className="mt-3 overflow-hidden rounded-lg border border-edge">
                      {fix.files.map((file) => (
                        <li key={file.path} className="flex justify-between gap-3 border-t border-edge px-3 py-2 font-mono text-[13px] first:border-t-0">
                          <span className="truncate">{file.path}</span>
                          <span className="shrink-0">
                            <span className="text-ok">+{file.added}</span> <span className="text-bad">−{file.removed}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2.5 text-[13px] text-faint">
                    {modelLabel(fix.model)} · {fix.effort} effort
                    {fix.attempts && fix.attempts.length > 1 && ` · ${fix.attempts.length} attempts`}
                  </p>
                  {fix.attempts && fix.attempts.length > 1 && (
                    <ol className="mt-1.5 space-y-1 text-[13px] text-dim">
                      {fix.attempts.map((attempt, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="tabular-nums text-faint">{i + 1}.</span>
                          <span className="min-w-0">
                            {attempt.summary} <span className="text-fg">{attempt.result}</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
              {steps.length > 0 && (
                <div>
                  <Label>{before ? "Kane's steps, before the fix" : "Kane's steps"}</Label>
                  <Steps steps={steps} current={current} onSeek={broken.scenario.clip?.mp4 ? playStep : undefined} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

type ScenariosProps = { runs: Run[]; at: number; scenario: string | undefined };

export function Scenarios({ runs, at, scenario }: ScenariosProps) {
  const view = runs.slice(at);
  // Open on a requested scenario, then a repaired flow after a successful fix.
  // Manual tab choices stay selected as new reports arrive.
  const scenarios = latestScenarios(view);
  const [picked, setPicked] = useState<string>();
  const current = scenarios.find((s) => s.id === picked) ?? defaultScenario(view, scenario);
  // The tabs are drawn anew with each scenario (ScenarioView is keyed by it), so the strip keeps its
  // sideways scroll here and shows the picked tab, instead of jumping back to the first one.
  const scrolled = useRef(0);
  const strip = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      el.scrollLeft = scrolled.current;
      const tab = el.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!tab) return;
      const left = tab.offsetLeft;
      const right = left + tab.offsetWidth;
      if (left < el.scrollLeft) el.scrollLeft = left - 8;
      else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth + 8;
      scrolled.current = el.scrollLeft;
    },
    [current?.id],
  );
  const told = current && story(view, current.id);
  if (!current || !told) return <p className="text-dim">This run had no scenarios to check.</p>;

  const { now, before } = told;
  const fix = before && view.find((r) => r.fix?.status === "fixed" && r.at > before.run.at)?.fix;
  // On a phone the tabs scroll sideways; the fade at the right edge says there are more.
  const tabs = scenarios.length > 1 && (
    <div
      ref={strip}
      onScroll={(e) => (scrolled.current = e.currentTarget.scrollLeft)}
      role="tablist"
      aria-label="Scenarios"
      className="relative flex overflow-x-auto overflow-y-hidden border-b border-edge px-2 [scrollbar-width:none] max-sm:[mask-image:linear-gradient(to_right,#000_80%,transparent)] sm:px-3">
      {scenarios.map((s) => {
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
            <Mark kind={story(view, s.id)?.now.scenario.outcome ?? s.outcome} /> {s.name}
          </button>
        );
      })}
    </div>
  );

  return <ScenarioView key={`${current.id}@${view[0]?.key}`} now={now} before={before} fix={fix} tabs={tabs} />;
}

export const GitHubMark = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

// `scenario`: the tab to open on, by name (the inbox's squares link to one).
type PullProps = {
  repo: string;
  pr: number;
  scenario: string | undefined;
  listed: PullView | undefined;
  go: (route: Route) => void;
  asked: ReturnType<typeof useAsk>[0];
  ask: Ask;
};

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="flex gap-6 pb-3 shadow-[inset_0_-1px_0_var(--color-edge)]">
        {[36, 28, 24].map((w) => (
          <span key={w} className={`${bone} h-4`} style={{ width: `${w * 4}px` }} />
        ))}
      </div>
      <span className={`${bone} mt-7 block h-6 w-3/5`} />
      <span className={`${bone} mt-6 block aspect-video w-full rounded-lg`} />
    </div>
  );
}

export function Pull({ repo, pr, scenario, listed, go, asked, ask }: PullProps) {
  // Read more often while Kane or Claude is at work on it, as the inbox does.
  const busy = listed?.state === "running" || listed?.state === "fixing";
  const [detail] = useLoad<PullDetail>(`/api/pulls/${repo}/${pr}`, busy ? 5_000 : 20_000);
  const pull = detail.status === "ok" ? detail.data.pull : listed;
  const state = asked({ repo, pr });
  const kind = pull && kindOf(pull);
  const canFix = kind === "failed" && pull?.fix?.status !== "gave-up";
  // Which run the page shows: the latest unless one was picked under the title.
  const [runKey, setRunKey] = useState<string>();
  const runs = detail.status === "ok" ? detail.data.runs : [];
  const at = Math.max(0, runs.findIndex((r) => r.key === runKey));

  const canRerun = kind !== "fixing" && kind !== "running" && !pull?.paused;
  const fixable = canFix && !pull?.paused;
  const locked = { disabled: state === "sending" || !!pull?.readOnly, title: pull?.readOnly ? NEEDS_WRITE : undefined };

  return (
    <main className="mx-auto max-w-6xl px-4 pb-8 sm:px-8 md:py-7">
      <MobileBar
        back={
          <Link to={{ page: "inbox" }} go={go} title="Inbox" className={iconButton}>
            <ChevronLeft size={20} aria-label="Inbox" />
          </Link>
        }
        title={
          <>
            {repo.split("/")[1]} <span className="font-normal text-faint">#{pr}</span>
          </>
        }
        actions={
          pull && (
            <a href={pull.url} aria-label="Open on GitHub" title="Open on GitHub" className={iconButton}>
              <GitHubMark />
            </a>
          )
        }
      />
      <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-[13px] text-faint max-md:hidden">
        <Link to={{ page: "inbox" }} go={go} className="rounded hover:text-fg">
          Inbox
        </Link>
        <ChevronRight size={14} />
        <span>{repo.split("/")[1]}</span>
      </nav>
      <div className="max-md:h-4" />
      <PageTitle
        onPhone="title"
        sub={runs.length > 0 && <RunMeta runs={runs} at={at} onAt={setRunKey} checking={pull?.checking && (kind === "running" || kind === "fixing") ? { ...pull.checking, kind } : undefined} />}
        aside={
          pull && (
            // On a phone these are the MobileBar's GitHub and the action bar at the bottom.
            <div className="flex flex-wrap items-center gap-2 max-md:hidden">
              {typeof state === "object" && <span className="text-[13px] text-bad">{state.error}</span>}
              {fixable && (
                <button type="button" className={solid} {...locked} onClick={() => ask(pull, "fix")}>
                  Fix with {fixerName(pull)}
                </button>
              )}
              {canRerun && (
                <button type="button" className={outline} {...locked} onClick={() => ask(pull, "rerun")}>
                  <RotateCw size={14} /> Run again
                </button>
              )}
              <a href={pull.url} className={outline}>
                <GitHubMark /> Open on GitHub
              </a>
            </div>
          )
        }
      >
        <span className="flex items-start gap-2.5">
          {kind && (
            <span className="flex h-[30px] shrink-0 items-center md:h-[34px]">
              <Mark kind={kind} size={18} />
            </span>
          )}
          <span className="pr-title min-w-0" data-title={titleName({ repo, pr })} style={{ viewTransitionName: movingName({ repo, pr }) }}>
            {pull?.title ?? "Pull request"} <span className="font-normal text-faint">#{pr}</span>
          </span>
        </span>
      </PageTitle>

      {detail.status === "error" && <p className="mt-6 text-bad">{detail.message}</p>}
      {detail.status === "loading" && (
        <section className="mt-6">
          <Skeleton />
        </section>
      )}
      {detail.status === "ok" && (
        <section className="mt-6">
            {/* While Kane or Claude is at work, the run as it goes comes first; the last report is under it. */}
            {(kind === "running" || kind === "fixing") && <LiveRun repo={repo} pr={pr} />}
            {detail.data.runs.length > 0 ? (
              <>
                {(kind === "running" || kind === "fixing") && <h2 className="mb-3 mt-9 text-[13px] font-medium text-faint">The last report</h2>}
                <Scenarios runs={runs} at={at} scenario={scenario} />
              </>
            ) : kind === "running" || kind === "fixing" ? null : (
              <div className="max-w-xl">
                <p>{detail.data.pull.headline}</p>
                <p className="mt-2 text-dim">
                  This report was posted before Proofed kept run details. The clips and Kane's notes are in{" "}
                  <a href={detail.data.pull.url} className={link}>
                    the comment on GitHub
                  </a>
                  ; the next run will show here.
                </p>
              </div>
            )}
        </section>
      )}

      {/* A phone's actions, at the bottom where a thumb is (the TabBar steps aside on this page). */}
      {pull && (fixable || canRerun) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-edge bg-side px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 md:hidden">
          {typeof state === "object" && <p className="mb-2 text-[13px] text-bad">{state.error}</p>}
          <div className="flex gap-2">
            {fixable && (
              <button type="button" className={`${solid} h-11 flex-1 text-[15px]`} {...locked} onClick={() => ask(pull, "fix")}>
                Fix with {fixerName(pull)}
              </button>
            )}
            {canRerun && (
              <button type="button" className={`${outline} h-11 text-[15px] ${fixable ? "px-4" : "flex-1"}`} {...locked} onClick={() => ask(pull, "rerun")}>
                <RotateCw size={16} /> Run again
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
