import { Play } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { BLANK_PAGE } from "../../../src/report/runfile";
import { defaultScenario, latestScenarios, scenarioStory as story } from "../run-summary";
import { modelLabel, providerLabel, providerOf } from "../worker/models";
import type { Run, RunScenario } from "../worker/runs";
import { Compare, Recording, type Seek, type Step } from "./PullScenarioMedia";
import { focus, Mark, plain, Segmented, soft } from "./ui";

type Seen = { run: Run; scenario: RunScenario };

function verdict({ outcome, reason, suggestion }: RunScenario) {
  if (outcome === "passed") return reason || "Passes.";
  if (outcome === "unsure") return [reason, suggestion].filter(Boolean).join(" ") || "The check was not confirmed.";
  return reason || (outcome === "error" ? "Kane couldn't finish this run." : "Broke.");
}

// Kane's steps. Where the clip knows when a step starts, the step plays the clip from there, and
// the step on screen while it plays is lit.
// Pointing at a step lights its mark on the clip's track, and the other way round (`lit`).
function Steps({ steps, current, onSeek, lit, onLit }: { steps: Step[]; current: number; onSeek?: (at: number) => void; lit?: number; onLit: (i: number | undefined) => void }) {
  return (
    // Rows reach a little past the column on a wide screen, so the numbers line up with the text above;
    // a phone has no room to spare at its edges.
    <ol className="md:-mx-3">
      {steps.map((step, i) => {
        const on = i === current;
        const at = onSeek && step.at;
        // The broken step: a red edge and the faintest tint, so it's found at once without shouting over the page.
        const look = `group flex w-full gap-3 rounded-md px-3 py-1.5 text-left ${soft} ${
          step.failed ? "bg-bad/[0.07] text-fg shadow-[inset_2px_0_0_var(--color-bad)]" : on ? "bg-hover text-fg" : lit === i ? "bg-hover/60 text-fg" : "text-dim"
        }`;
        const body = (
          <>
            <span className="flex h-5 w-5 shrink-0 items-center justify-end">
              {step.failed ? (
                <Mark kind="failed" />
              ) : (
                <span className={`translate-y-px font-mono text-[12px] tabular-nums ${on ? "text-fg" : "text-faint"} ${at !== undefined ? "group-hover:hidden" : ""}`}>{i + 1}</span>
              )}
              {at !== undefined && !step.failed && <Play size={13} className="hidden text-fg group-hover:block" />}
            </span>
            <span className="min-w-0">{plain(step.remark)}</span>
          </>
        );
        return (
          <li key={i} onPointerEnter={() => onLit(i)} onPointerLeave={() => onLit(undefined)}>
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

const Label = ({ children }: { children: ReactNode }) => <h3 className="mb-2.5 text-[13px] font-medium text-fg">{children}</h3>;

type Mode = "before" | "compare" | "after";

// One scenario as a run left it: what broke and why on top, in words; under it the recording, large,
// and what the fixer changed; Kane's steps beside the recording, so a step and its moment in the clip
// are seen together.
function ScenarioView({ now, before, fix, tabs, list }: { now: Seen; before: Seen | undefined; fix: Run["fix"]; tabs: ReactNode; list: ReactNode }) {
  const comparable = !!(before?.scenario.clip?.jpg && now.scenario.clip?.jpg);
  const [mode, setMode] = useState<Mode>(comparable ? "compare" : "after");
  const [seek, setSeek] = useState<Seek>();
  const [time, setTime] = useState<number>();
  const [lit, setLit] = useState<number>();
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

  // Text under the heading lines up with its name, past the mark; on a phone with tabs there is no heading.
  const pad = tabs ? "lg:pl-[30px]" : "pl-[30px]";
  const facts = <RunFacts runs={before ? [now.run, before.run] : [now.run]} />;
  const stepsBlock = steps.length > 0 && (
    <div>
      <Label>{before ? "Kane's steps, before the fix" : "Kane's steps"}</Label>
      <Steps steps={steps} current={current} onSeek={broken.scenario.clip?.mp4 ? playStep : undefined} lit={playsBroken ? lit : undefined} onLit={setLit} />
    </div>
  );

  return (
    // Wide: the story and its recording in the main column; the scenarios and the steps in a rail beside
    // it that stays in view, so the steps sit next to the clip as it plays. A phone has the scenarios
    // as tabs on top and the steps under the clip.
    <section className="lg:grid lg:grid-cols-[minmax(0,1fr)_18.5rem] lg:gap-10 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0">
        {tabs && <div className="lg:hidden">{tabs}</div>}
        <div className="pt-5 lg:pt-1">
          {/* Which scenario this is, then what Kane found, in its words. What it cost is in the rail. */}
          {/* With tabs above it (a phone), the tab already names the scenario. */}
          <h2 className={`flex items-center gap-2.5 text-[18px] font-semibold leading-7 tracking-[-0.015em] ${tabs ? "max-lg:sr-only" : ""}`}>
            <Mark kind={now.scenario.outcome} size={18} />
            <span className="min-w-0">{now.scenario.name}</span>
          </h2>
          <p className={`mt-1.5 ${pad} text-[15px] leading-6 text-fg`}>{verdict(now.scenario)}</p>
          {before && (
            <p className={`mt-2 ${pad} text-dim`}>
              <span className="text-faint">Before the fix:</span> {verdict(before.scenario)}
            </p>
          )}
          {/* Why it broke, under what broke: the same size, a step quieter. */}
          {why && !crashed && <p className={`mt-2 max-w-3xl ${pad} text-[15px] leading-6 text-dim`}>{why}</p>}
          {now.scenario.outcome === "failed" && now.scenario.suggestion && <p className={`mt-1.5 max-w-3xl ${pad} text-dim`}>{now.scenario.suggestion}</p>}
        </div>

        {media && (
          <figure ref={frame} className="mt-6 min-w-0 scroll-my-4 overflow-hidden rounded-xl border border-edge bg-bg shadow-[0_12px_32px_-16px_rgb(0_0_0/0.5)]">
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
                  lit={playsBroken ? lit : undefined}
                  onLit={setLit}
                />
              )
            )}
          </figure>
        )}

        {((crashed && why) || fix || stepsBlock) && (
          <div className="mt-8 space-y-8">
            {crashed && why && (
              <div>
                {/* A page that crashed on load: Kane never ran, the browser said this. Other step-less failures carry Kane's diagnosis. */}
                <Label>{now.scenario.reason === BLANK_PAGE ? "Browser console error" : "What Kane saw"}</Label>
                <p className="font-mono text-[13px] text-dim">{why}</p>
              </div>
            )}
            {fix && <FixStory fix={fix} />}
            {stepsBlock && <div className="lg:hidden">{stepsBlock}</div>}
          </div>
        )}
        <div className="mt-8 lg:hidden">{facts}</div>
      </div>

      <aside className="space-y-8 self-start max-lg:hidden lg:sticky lg:top-6">
        {/* What the run cost first: it's what's asked before which scenario to look at. */}
        {facts}
        {list}
        {stepsBlock}
      </aside>
    </section>
  );
}

const minSec = (seconds: number) => (seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`);

// The run on the page, in figures: Kane's time and credits (with the fix's run, both runs together)
// and the run's logs. Each scenario's own credits are beside it in the list under this.
function RunFacts({ runs }: { runs: Run[] }) {
  const all = runs.flatMap((r) => r.scenarios);
  const seconds = Math.round(all.reduce((n, s) => n + (s.seconds ?? 0), 0));
  const credits = Math.round(all.reduce((n, s) => n + (s.credits ?? 0), 0));
  const balance = runs[0]?.scenarios.findLast((s) => s.accountBalance)?.accountBalance?.after;
  const logs = runs[0]?.runUrl;
  const rows: [string, ReactNode][] = [
    ...(seconds ? [["Kane in Chrome", minSec(seconds)] as [string, ReactNode]] : []),
    ...(credits ? [["Credits", <span title="As Kane estimates them">{credits}{runs.length > 1 ? ` in ${runs.length} runs` : ""}</span>] as [string, ReactNode]] : []),
    ...(balance !== undefined ? [["Left on TestMu", Math.round(balance).toLocaleString("en-US")] as [string, ReactNode]] : []),
    ...(logs ? [["Logs", <a href={logs} target="_blank" rel="noreferrer" className="underline decoration-edge underline-offset-4 hover:decoration-fg">GitHub Actions</a>] as [string, ReactNode]] : []),
  ];
  if (rows.length === 0) return null;
  return (
    <div>
      <Label>{runs.length > 1 ? "These runs" : "This run"}</Label>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-faint">{label}</dt>
            <dd className="text-right tabular-nums text-fg">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// What the fixer changed: its own words, the files, and the tries it took.
function FixStory({ fix }: { fix: NonNullable<Run["fix"]> }) {
  return (
    <div>
      <Label>What {providerLabel(providerOf(fix.model))} changed</Label>
      {fix.summary && <p className="max-w-3xl">{fix.summary}</p>}
      {fix.files && fix.files.length > 0 && (
        <ul className="mt-3 max-w-xl overflow-hidden rounded-lg border border-edge">
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
        <ol className="mt-1.5 max-w-3xl space-y-1 text-[13px] text-dim">
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
      className="relative flex overflow-x-auto overflow-y-hidden border-b border-edge [scrollbar-width:none] max-md:-mx-4 max-md:px-1 max-sm:[mask-image:linear-gradient(to_right,#000_80%,transparent)]">
      {scenarios.map((s) => {
        const on = s.id === current.id;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => setSelection({ scenario, picked: s.id })}
            className={`-mb-px flex h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 md:first:pl-0 md:[&+*]:ml-1 ${soft} ${focus} focus-visible:ring-inset ${on ? "border-fg font-medium text-fg" : "border-transparent text-dim hover:text-fg"}`}
          >
            <Mark kind={story(view, s.id)?.now.scenario.outcome ?? s.outcome} /> {s.name}
          </button>
        );
      })}
    </div>
  );

  // A scenario's credits in the run on the page: the parts of the rail's total above the list.
  // After a fix, its run and the broken one together, as the rail's total counts them.
  const credits = (id: string) => {
    const told = story(view, id);
    const c = (told?.now.scenario.credits ?? 0) + (told?.before?.scenario.credits ?? 0);
    return c ? Math.round(c) : undefined;
  };
  // The rail's list on a wide screen: the scenarios down the side, like the sidebar's places.
  const list = scenarios.length > 1 && (
    <div>
      <Label>Scenarios</Label>
      <div role="tablist" aria-label="Scenarios" aria-orientation="vertical" className="-mx-3 flex flex-col gap-0.5">
        {scenarios.map((s) => {
          const on = s.id === current.id;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setSelection({ scenario, picked: s.id })}
              className={`flex h-8 items-center gap-3 rounded-md px-3 text-left ${soft} ${focus} ${on ? "bg-hover font-medium text-fg" : "text-dim hover:bg-hover/60 hover:text-fg"}`}
            >
              <Mark kind={story(view, s.id)?.now.scenario.outcome ?? s.outcome} />
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              {credits(s.id) !== undefined && (
                <span className="text-[12px] font-normal tabular-nums text-faint" title="Credits, as Kane estimates them">
                  {credits(s.id)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  return <ScenarioView key={`${current.id}@${view[0]?.key}`} now={now} before={before} fix={fix} tabs={tabs} list={list} />;
}
