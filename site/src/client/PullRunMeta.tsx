import { Check, ChevronDown } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { fixedSummary } from "../run-summary";
import { providerLabel, providerOf } from "../worker/models";
import type { Run, RunScenario } from "../worker/runs";
import { ago } from "./lib";
import { Backdrop, focus, link, marks, popover, sha7, soft, useDismiss, useSheetDrag } from "./ui";

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

const runText = (run: Run) =>
  run.scenarios.some((s) => s.outcome === "failed") ? "text-bad" : run.scenarios.some((s) => s.outcome !== "passed") ? "text-busy" : "text-ok";


// The line under the title: how the shown run went (in its colour), when, and on which commit. With
// more than one run the commit opens the list of them, and picking one shows the pull request as that
// run left it. What a run took (time, credits) is beside the scenarios, in the page's rail.
// The commit Kane or Claude is at work on heads the list in their color until its run reports.
type Checking = { sha: string; at: number; kind: "running" | "fixing" };
export function RunMeta({ runs, at, onAt, checking }: { runs: Run[]; at: number; onAt: (key: string | undefined) => void; checking?: Checking }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, box);
  const run = runs[at];
  const hasHistory = runs.length > 1 || !!checking;
  const sheet = useSheetDrag<HTMLSpanElement>(open && !!run && hasHistory, close);
  if (!run) return null;
  const when = ago(run.at) === "now" ? "just now" : `${ago(run.at)} ago`;
  const dot = <span aria-hidden>·</span>;
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-faint">
      <span className={`flex items-center gap-1.5 font-medium ${runText(run)}`}>
        <span className={`size-1.5 rounded-full ${runDot(run)}`} />
        {runLabel(run, runs.slice(at))}
      </span>
      {dot}
      <span>{when} on</span>
      {hasHistory ? (
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
