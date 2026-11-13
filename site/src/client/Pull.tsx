import { ChevronRight, Maximize2, Play, RotateCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { modelLabel } from "../worker/models";
import type { PullDetail, Run, RunScenario } from "../worker/runs";
import { ago, plural, useLoad, type Ask, type Route, type useAsk } from "./lib";
import { focus, iconButton, kindOf, Link, link, Mark, outline, PageTitle, Segmented, sha7, solid } from "./ui";

type Seen = { run: Run; scenario: RunScenario };

// A scenario as the page shows it: how it ended in the latest run it was part of, and, when
// that's a pass, the last run where it was broken. Runs come newest first.
function story(runs: Run[], id: string) {
  const seen = runs.flatMap((run): Seen[] => {
    const scenario = run.scenarios.find((s) => s.id === id);
    return scenario ? [{ run, scenario }] : [];
  });
  const [now, ...earlier] = seen;
  if (!now) return undefined;
  const before = now.scenario.outcome === "passed" ? earlier.find((s) => s.scenario.outcome === "failed") : undefined;
  return { now, before };
}

function verdict({ outcome, reason, suggestion }: RunScenario) {
  if (outcome === "passed") return reason || "Passes.";
  if (outcome === "unsure") return [reason, suggestion].filter(Boolean).join(" ") || "The test may be wrong, not the code.";
  return reason || (outcome === "error" ? "Kane couldn't finish this run." : "Broke.");
}

// The still is what the run ended on, so it's shown as it is; the recording starts on click.
function Recording({ clip }: { clip: NonNullable<RunScenario["clip"]> }) {
  const [playing, setPlaying] = useState(false);
  const still = clip.jpg ?? clip.gif;
  const video = clip.mp4 && (playing || !still);
  return (
    <>
      {video ? (
        <video src={clip.mp4} poster={clip.jpg} controls muted playsInline autoPlay={playing} className="block aspect-video w-full bg-black" />
      ) : still ? (
        clip.mp4 ? (
          <button type="button" onClick={() => setPlaying(true)} aria-label="Play the run" className={`block w-full ${focus}`}>
            <img src={still} alt="Where Kane's run in the browser ended" className="block w-full" />
          </button>
        ) : (
          <img src={still} alt="Where Kane's run in the browser ended" className="block w-full" />
        )
      ) : null}
      <div className="flex items-center gap-1 border-t border-edge px-1.5 py-1.5">
        {clip.mp4 && !playing && still && (
          <button type="button" onClick={() => setPlaying(true)} className={`${outline} h-7 border-transparent px-2`}>
            <Play size={14} /> Play the run
          </button>
        )}
        <a href={still ?? clip.mp4} target="_blank" rel="noreferrer" className={`${outline} ml-auto h-7 border-transparent px-2 text-dim`}>
          <Maximize2 size={14} /> Full size
        </a>
      </div>
    </>
  );
}

const tint = (outcome: RunScenario["outcome"]) => (outcome === "passed" ? "bg-ok-bg" : outcome === "failed" ? "bg-bad-bg" : "bg-hover");

function Verdict({ seen, label, on, onPick }: { seen: Seen; label?: string; on?: boolean; onPick?: () => void }) {
  const { scenario, run } = seen;
  const body = (
    <>
      <span className="pt-px">
        <Mark kind={scenario.outcome} />
      </span>
      <span className="min-w-0">
        {label && (
          <span className="mr-2 font-medium">
            {label} <span className="font-mono text-[12px] font-normal text-faint">{sha7(run.sha)}</span>
          </span>
        )}
        {verdict(scenario)}
      </span>
    </>
  );
  const box = `flex w-full gap-2.5 px-3.5 py-2.5 text-left ${on === false ? "text-dim" : tint(scenario.outcome)}`;
  return onPick ? (
    <button type="button" onClick={onPick} aria-pressed={on} className={`${box} ${focus} ${on === false ? "hover:bg-hover/60 hover:text-fg" : ""}`}>
      {body}
    </button>
  ) : (
    <p className={box}>{body}</p>
  );
}

// One frame, as large as the column allows, so what Kane saw can be read. With a fix in the
// story, the same frame switches between the broken run and the passing one.
function Proof({ now, before }: { now: Seen; before: Seen | undefined }) {
  const [showBefore, setShowBefore] = useState(false);
  const shown = before && showBefore ? before : now;
  return (
    <figure className="overflow-hidden rounded-lg border border-edge bg-panel">
      {before && (
        <div className="flex items-center gap-3 border-b border-edge px-2 py-2">
          <Segmented
            label="Which run"
            value={showBefore ? "before" : "after"}
            onChange={(v) => setShowBefore(v === "before")}
            options={[
              { value: "before", label: "Before the fix" },
              { value: "after", label: "After" },
            ]}
          />
        </div>
      )}
      {shown.scenario.clip && <Recording key={shown.run.key} clip={shown.scenario.clip} />}
      <figcaption className="divide-y divide-edge border-t border-edge">
        {before ? (
          <>
            <Verdict seen={before} label="Before" on={showBefore} onPick={() => setShowBefore(true)} />
            <Verdict seen={now} label="After" on={!showBefore} onPick={() => setShowBefore(false)} />
          </>
        ) : (
          <Verdict seen={now} />
        )}
      </figcaption>
    </figure>
  );
}

const Heading = ({ children }: { children: ReactNode }) => <h2 className="mb-2.5 mt-8 font-semibold first:mt-0">{children}</h2>;
const SideHeading = ({ children }: { children: ReactNode }) => <h2 className="mb-2 mt-7 text-[13px] font-medium text-faint first:mt-0">{children}</h2>;

// Kane starts each remark with the kind of step ("click: Clicking Pause"); the words alone say it.
const plain = (remark: string) => {
  const text = remark.replace(/^[a-z_]+:\s+/, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

function Steps({ scenario }: { scenario: RunScenario }) {
  if (!scenario.steps?.length) return null;
  return (
    <ol className="-mx-3">
      {scenario.steps.map((step, i) => (
        <li key={i} className={`flex gap-3 rounded-md px-3 py-1.5 ${step.failed ? "bg-bad-bg" : "text-dim"}`}>
          <span className="flex w-5 shrink-0 justify-end pt-0.5">
            {step.failed ? <Mark kind="failed" /> : <span className="font-mono text-[12px] tabular-nums text-faint">{i + 1}</span>}
          </span>
          <span className="min-w-0">{plain(step.remark)}</span>
        </li>
      ))}
    </ol>
  );
}

function runLabel(run: Run) {
  const count = (outcome: RunScenario["outcome"]) => run.scenarios.filter((s) => s.outcome === outcome).length;
  if (run.fix?.status === "fixed") return "fixed by Claude";
  if (count("failed") > 0) return `${count("failed")} of ${run.scenarios.length} broke`;
  if (count("error") > 0) return "couldn't finish";
  if (count("unsure") > 0) return "test may be wrong";
  return run.scenarios.length === 0 ? "nothing to run" : `${run.scenarios.length} pass`;
}

const runDot = (run: Run) =>
  run.scenarios.some((s) => s.outcome === "failed") ? "bg-bad" : run.scenarios.some((s) => s.outcome !== "passed") ? "bg-busy" : "bg-ok";

const duration = (seconds: number) => (seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`);

// What one run cost and took, for the line under the title.
function runCost(run: Run) {
  const sum = (pick: (s: RunScenario) => number | undefined) => run.scenarios.reduce((total, s) => total + (pick(s) ?? 0), 0);
  const seconds = Math.round(sum((s) => s.seconds));
  const credits = Math.round(sum((s) => s.credits));
  return [seconds > 0 && duration(seconds), credits > 0 && `${credits} Kane credits`].filter(Boolean).join(" · ");
}

function Aside({ runs }: { runs: Run[] }) {
  // The fix belongs to the run that published it; it stays on show while later runs still pass.
  const fix = runs.find((r) => r.fix)?.fix;

  return (
    <aside className="mt-8 lg:mt-0">
      <SideHeading>Runs</SideHeading>
      <ol className="-mx-2">
        {runs.map((run) => (
          <li key={run.key} className="flex items-center gap-2.5 rounded-md px-2 py-1">
            <span className={`size-2 shrink-0 rounded-full ${runDot(run)}`} />
            <span className="font-mono text-[12px]">{sha7(run.sha)}</span>
            <span className="min-w-0 flex-1 truncate text-dim">{runLabel(run)}</span>
            <span className="text-[13px] tabular-nums text-faint">{ago(run.at)}</span>
          </li>
        ))}
      </ol>
      {fix && (
        <>
          <SideHeading>{fix.status === "fixed" ? "Fix" : "Claude couldn't fix it"}</SideHeading>
          <p>
            {modelLabel(fix.model)} <span className="text-dim">· {fix.effort} effort</span>
          </p>
          {fix.attempts && fix.attempts.length > 1 && (
            <ol className="mt-3 space-y-2.5 text-[13px] text-dim">
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
        </>
      )}
    </aside>
  );
}

function Scenarios({ runs }: { runs: Run[] }) {
  // Every scenario any run touched, the latest run's first; open on the one that needs a look.
  const scenarios = [...new Map(runs.flatMap((r) => r.scenarios).map((s) => [s.id, s])).values()];
  const [picked, setPicked] = useState<string>();
  const current = scenarios.find((s) => s.id === picked) ?? scenarios.find((s) => s.outcome !== "passed") ?? scenarios[0];
  const told = current && story(runs, current.id);
  if (!current || !told) return <p className="text-dim">This run had no scenarios to check.</p>;

  const { now, before } = told;
  const broken = before ?? now;
  const fix = before && runs.find((r) => r.fix?.status === "fixed" && r.at > before.run.at)?.fix;

  return (
    <>
      {scenarios.length > 1 && (
        <div role="tablist" aria-label="Scenarios" className="-mx-4 mb-5 flex overflow-x-auto overflow-y-hidden px-4 shadow-[inset_0_-1px_0_var(--color-edge)] [scrollbar-width:none] sm:mx-0 sm:px-0">
          {scenarios.map((s) => {
            const on = s.id === current.id;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setPicked(s.id)}
                className={`flex h-10 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 first:pl-0.5 ${focus} ${on ? "border-fg font-medium text-fg" : "border-transparent text-dim hover:text-fg"}`}
              >
                <Mark kind={story(runs, s.id)?.now.scenario.outcome ?? s.outcome} /> {s.name}
              </button>
            );
          })}
        </div>
      )}

      <Proof key={current.id} now={now} before={before} />

      <div className="mt-8 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-12">
        <div className="min-w-0">
      {now.scenario.outcome !== "passed" && now.scenario.diagnosis && now.scenario.diagnosis !== now.scenario.reason && (
        <>
          <Heading>What Kane saw</Heading>
          <p className="max-w-3xl text-dim">{now.scenario.diagnosis}</p>
        </>
      )}

      {broken.scenario.steps?.length ? (
        <>
          <Heading>{before ? "Kane's steps, before the fix" : "Kane's steps"}</Heading>
          <Steps scenario={broken.scenario} />
        </>
      ) : null}
      {fix && (
        <>
          <Heading>What changed</Heading>
          {fix.summary && <p className="max-w-3xl text-dim">{fix.summary}</p>}
          <ul className="mt-3 overflow-hidden rounded-lg border border-edge">
            {fix.files?.map((file) => (
              <li key={file.path} className="flex justify-between gap-3 border-t border-edge px-3 py-2 font-mono text-[13px] first:border-t-0">
                <span className="truncate">{file.path}</span>
                <span className="shrink-0">
                  <span className="text-ok">+{file.added}</span> <span className="text-bad">−{file.removed}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
        </div>
        <Aside runs={runs} />
      </div>
    </>
  );
}

const GitHubMark = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

function RunLine({ run }: { run: Run }) {
  const cost = runCost(run);
  return (
    <p className="mt-1.5 pl-7 text-[13px] text-faint">
      Checked {ago(run.at) === "now" ? "just now" : `${ago(run.at)} ago`} on <span className="font-mono text-[12px]">{sha7(run.sha)}</span>
      {cost && ` · ${cost}`}
      {run.runUrl && (
        <>
          {" · "}
          <a href={run.runUrl} className={`${link} hover:text-fg`}>
            Workflow logs
          </a>
        </>
      )}
    </p>
  );
}

type PullProps = { repo: string; pr: number; go: (route: Route) => void; asked: ReturnType<typeof useAsk>[0]; ask: Ask };

export function Pull({ repo, pr, go, asked, ask }: PullProps) {
  const [detail] = useLoad<PullDetail>(`/api/pulls/${repo}/${pr}`, 20_000);
  const pull = detail.status === "ok" ? detail.data.pull : undefined;
  const state = asked({ repo, pr });
  const kind = pull && kindOf(pull);
  const canFix = kind === "failed" && pull?.fix?.status !== "gave-up";

  return (
    <main className="mx-auto max-w-6xl px-4 py-5 sm:px-8 sm:py-7">
      <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1 text-[13px] text-faint">
        <Link to={{ page: "inbox" }} go={go} className="rounded hover:text-fg">
          Inbox
        </Link>
        <ChevronRight size={14} />
        <span>{repo.split("/")[1]}</span>
      </nav>
      <PageTitle
        sub={detail.status === "ok" && detail.data.runs[0] && <RunLine run={detail.data.runs[0]} />}
        aside={
          pull && (
            <div className="flex items-center gap-2">
              {typeof state === "object" && <span className="text-[13px] text-bad">{state.error}</span>}
              {state === "sent" && <span className="text-[13px] text-dim">Asked on the PR</span>}
              {!state && canFix && !pull.paused && (
                <button type="button" className={solid} onClick={() => ask(pull, "fix")}>
                  Fix with Claude
                </button>
              )}
              {!state && pull.state !== "fixing" && !pull.paused && (
                <button type="button" className={outline} onClick={() => ask(pull, "rerun")}>
                  <RotateCw size={14} /> Run again
                </button>
              )}
              <a href={pull.url} className={`${iconButton} border border-edge`} aria-label="Open on GitHub" title="Open on GitHub">
                <GitHubMark />
              </a>
            </div>
          )
        }
      >
        <span className="flex items-start gap-2.5">
          {kind && (
            <span className="pt-1">
              <Mark kind={kind} size={18} />
            </span>
          )}
          <span className="min-w-0">
            {pull?.title ?? "Pull request"} <span className="font-normal text-faint">#{pr}</span>
          </span>
        </span>
      </PageTitle>

      {detail.status === "loading" && <p className="mt-6 text-faint">Loading…</p>}
      {detail.status === "error" && <p className="mt-6 text-bad">{detail.message}</p>}
      {detail.status === "ok" && (
        <section className="mt-6">
            {detail.data.runs.length > 0 ? (
              <Scenarios runs={detail.data.runs} />
            ) : (
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
    </main>
  );
}
