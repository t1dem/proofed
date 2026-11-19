import { Play } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { BLANK_PAGE } from "../../../src/report/runfile";
import { defaultScenario, latestScenarios, scenarioStory as story } from "../run-summary";
import { modelLabel, providerLabel, providerOf } from "../worker/models";
import type { Run, RunScenario } from "../worker/runs";
import { Compare, Recording, type Seek, type Step } from "./PullScenarioMedia";
import { focus, Mark, panel, plain, Segmented, soft } from "./ui";

type Seen = { run: Run; scenario: RunScenario };

function verdict({ outcome, reason, suggestion }: RunScenario) {
  if (outcome === "passed") return reason || "Passes.";
  if (outcome === "unsure") return [reason, suggestion].filter(Boolean).join(" ") || "The check was not confirmed.";
  return reason || (outcome === "error" ? "Kane couldn't finish this run." : "Broke.");
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
                  {/* A page that crashed on load: Kane never ran, the browser said this. Other step-less failures carry Kane's diagnosis. */}
                  <Label>{now.scenario.reason === BLANK_PAGE ? "Browser console error" : "What Kane saw"}</Label>
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
  const [selection, setSelection] = useState<{ scenario: string | undefined; picked?: string }>({ scenario });
  const navigated = selection.scenario !== scenario;
  if (navigated) setSelection({ scenario });
  const picked = navigated ? undefined : selection.picked;
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

  const { now, before, fix } = told;
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
            onClick={() => setSelection({ scenario, picked: s.id })}
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
