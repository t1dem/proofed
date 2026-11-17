// "Break it yourself" (/try, /try/<pr>): no sign-in. A visitor opens one of a few prepared pull
// requests on the demo store and watches the real run: the same live view and report the dashboard
// shows, read from the public API (worker/try.ts).
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import type { PullDetail, PullState } from "../worker/runs";
import type { TryRun, TryView } from "../worker/try";
import { providerLabel, providerOf } from "../worker/models";
import { ago, api, fixerName, message, useLoad } from "./lib";
import { LiveRun } from "./Live";
import { GitHubMark, RunMeta, Scenarios } from "./Pull";
import { bone, focus, kindOf, link, Mark, outline, panel, soft, solid, type Kind } from "./ui";

const prOf = () => {
  const number = /^\/try\/(\d+)$/.exec(location.pathname)?.[1];
  return number ? Number(number) : undefined;
};

function useTryRoute() {
  const [pr, setPr] = useState(prOf);
  useEffect(() => {
    const onPop = () => setPr(prOf());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  const go = useCallback((next?: number) => {
    history.pushState(null, "", next ? `/try/${next}` : "/try");
    setPr(next);
    scrollTo({ top: 0, behavior: "instant" });
  }, []);
  return [pr, go] as const;
}

type Go = ReturnType<typeof useTryRoute>[1];

// A real link (⌘-click opens a tab) that otherwise changes the page in place.
function To({ pr, go, className, children }: { pr?: number; go: Go; className?: string; children: ReactNode }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go(pr);
  };
  return (
    <a href={pr ? `/try/${pr}` : "/try"} onClick={onClick} className={`${focus} ${className ?? ""}`}>
      {children}
    </a>
  );
}

function Top() {
  return (
    <header className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-8">
      <a href="/" className={`rounded font-serif text-xl ${focus}`}>
        Proofed
      </a>
      <nav className="flex items-center gap-5 text-[13px] text-dim">
        <a href="/app?demo" className={`rounded hover:text-fg ${focus}`}>
          Dashboard demo
        </a>
        <a href="https://github.com/t1dem/proofed" className={`rounded hover:text-fg ${focus}`}>
          GitHub
        </a>
      </nav>
    </header>
  );
}

const kindOfRun = (run: TryRun): Kind =>
  run.fixed ? "passed" : run.state === "fixing" ? "fixing" : run.state === "running" ? "running" : run.state === "failing" ? "failed" : run.state === "blocked" ? "error" : run.unsure ? "unsure" : "passed";

const saysOf = (run: TryRun) =>
  run.fixed
    ? `Kane caught it, ${providerLabel(providerOf(run.model || ""))} fixed it`
    : run.state === "running"
      ? "Kane is checking"
      : run.state === "fixing"
        ? `${providerLabel(providerOf(run.model || ""))} is fixing`
        : run.state === "failing"
          ? "Kane caught it"
          : run.state === "blocked"
            ? "The run didn't finish"
            : run.unsure
              ? "Kane didn't confirm it either way"
              : "Kane found nothing broken";

function Picker({ view, go, reload }: { view: TryView; go: Go; reload: () => Promise<void> }) {
  const [opening, setOpening] = useState<string>();
  const [error, setError] = useState<string>();
  const busy = !!view.current;
  const none = view.left === 0;

  const open = (bug: string) => {
    setOpening(bug);
    setError(undefined);
    api<{ pr: number }>("/api/try", { method: "POST", body: JSON.stringify({ bug }) }).then(
      ({ pr }) => reload().then(() => go(pr)),
      (e: unknown) => {
        setError(message(e));
        setOpening(undefined);
        void reload();
      },
    );
  };

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-8 sm:pt-12">
      <h1 className="font-serif text-[32px] leading-[1.1] tracking-[-0.01em] sm:text-[44px]">Break the store yourself</h1>
      <p className="mt-4 max-w-xl text-[15px] text-dim">
        Pick a pull request. Proofed opens it on{" "}
        <a href={`https://github.com/${view.repo}`} className={link}>
          {view.repo}
        </a>
        , a real repository. Kane runs the flows it touches in Chrome while you watch, and {view.provider ?? "the fixer"} fixes what breaks. No account needed.
      </p>

      {view.current && (
        <To pr={view.current.pr} go={go} className={`mt-8 flex items-center gap-3 rounded-xl border border-edge bg-panel px-4 py-3 ${soft} hover:bg-hover`}>
          <Mark kind={kindOfRun(view.current)} />
          <span className="min-w-0 flex-1">
            <span className="font-medium">A run is going now.</span> <span className="text-dim">{view.current.title}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[13px] font-medium">
            Watch <ArrowRight size={14} />
          </span>
        </To>
      )}

      <h2 className="mt-10 text-[13px] font-medium text-faint">Pull requests you can open</h2>
      <ul className={`${panel} mt-3 divide-y divide-edge`}>
        {view.bugs.map((bug) => (
          <li key={bug.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:flex-nowrap sm:px-5">
            <div className="min-w-0 flex-1 basis-64">
              <p className="font-medium">{bug.title}</p>
              <p className="mt-1 text-[13px] text-dim">{bug.says}</p>
            </div>
            <button type="button" className={solid} disabled={busy || none || !!opening} onClick={() => open(bug.id)}>
              {opening === bug.id ? "Opening…" : "Open it"}
            </button>
          </li>
        ))}
      </ul>
      <p className={`mt-3 text-[13px] ${error ? "text-bad" : "text-faint"}`} role={error ? "alert" : undefined}>
        {error ??
          (busy
            ? "One run at a time. The next can start when this one ends."
            : none
              ? "That's all the live runs for today. The recent ones below are real: open any of them."
              : `One run at a time, a few minutes each. ${view.left} left today.`)}
      </p>

      {view.recent.length > 0 && (
        <>
          <h2 className="mt-10 text-[13px] font-medium text-faint">Recent runs</h2>
          <ul className="-mx-3 mt-2">
            {view.recent.map((run) => (
              <li key={run.pr}>
                <To pr={run.pr} go={go} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${soft} hover:bg-hover`}>
                  <Mark kind={kindOfRun(run)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {run.title} <span className="text-faint">#{run.pr}</span>
                    </span>
                    <span className="block text-[13px] text-dim">{saysOf(run)}</span>
                  </span>
                  <span className="shrink-0 text-[13px] tabular-nums text-faint">{ago(run.finishedAt ?? run.startedAt)}</span>
                </To>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

// Where the pull request is on its way from opened to fixed.
function Track({ state, fixed, gaveUp, reported, unsure, provider }: { provider: string; state: PullState; fixed: boolean; gaveUp: boolean; reported: boolean; unsure: boolean }) {
  const check: Kind =
    state === "running" && !reported ? "running" : state === "blocked" && !reported ? "error" : state === "passing" && !fixed ? (unsure ? "unsure" : "passed") : "failed";
  const fix: Kind = fixed ? "passed" : gaveUp ? "error" : state === "fixing" ? "fixing" : "waiting";
  const steps: [Kind, string][] = [
    ["passed", "Pull request opened"],
    [check, check === "running" ? "Kane is checking it" : check === "failed" ? "Kane caught a break" : check === "error" ? "The run didn't finish" : check === "unsure" ? "Kane didn't confirm it either way" : "Kane found nothing broken"],
    [fix, fix === "passed" ? `${provider} fixed it, Kane confirmed` : fix === "error" ? `${provider} couldn't fix it` : fix === "fixing" ? `${provider} is fixing, Kane re-checks` : `${provider} fixes, Kane re-checks`],
  ];
  return (
    <ol className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
      {steps.map(([kind, text]) => (
        <li key={text} className={`flex items-center gap-2 ${kind === "waiting" ? "text-faint" : "text-dim"}`}>
          <Mark kind={kind} size={14} /> {text}
        </li>
      ))}
    </ol>
  );
}

function Run({ repo, pr, go }: { repo: string; pr: number; go: Go }) {
  const path = `/api/pulls/${repo}/${pr}`;
  const [busy, setBusy] = useState(true);
  const [detail] = useLoad<PullDetail>(path, busy ? 4_000 : 30_000);
  const [runKey, setRunKey] = useState<string>();
  const pull = detail.status === "ok" ? detail.data.pull : undefined;
  const runs = detail.status === "ok" ? detail.data.runs : [];
  const at = Math.max(0, runs.findIndex((r) => r.key === runKey));
  const kind = pull && kindOf(pull);
  const working = kind === "running" || kind === "fixing";
  const fix = runs[0]?.fix;
  // A failing report with no fix yet: "Fix automatically" is about to pick it up, so keep reading often.
  const waitingForFix = kind === "failed" && !fix && Date.now() - (pull?.updatedAt ?? 0) < 180_000;
  useEffect(() => setBusy(!pull || working || waitingForFix), [pull, working, waitingForFix]);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-4 sm:px-8 sm:pt-6">
      <To go={go} className="inline-flex items-center gap-1.5 rounded text-[13px] text-faint hover:text-fg">
        <ArrowLeft size={14} /> Break it yourself
      </To>
      <header className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="flex items-start gap-2.5 font-serif text-[24px] leading-[30px] tracking-[-0.01em] md:text-[28px] md:leading-[34px]">
            {kind && (
              <span className="flex h-[30px] shrink-0 items-center md:h-[34px]">
                <Mark kind={kind} size={18} />
              </span>
            )}
            <span className="min-w-0">
              {pull?.title ?? "Pull request"} <span className="font-sans font-normal text-faint">#{pr}</span>
            </span>
          </h1>
          {runs.length > 0 && <RunMeta runs={runs} at={at} onAt={setRunKey} checking={pull?.checking && working ? { ...pull.checking, kind } : undefined} />}
        </div>
        <a href={pull?.url ?? `https://github.com/${repo}/pull/${pr}`} className={outline}>
          <GitHubMark /> Open on GitHub
        </a>
      </header>

      {pull && <Track provider={fixerName(pull)} state={pull.state} fixed={fix?.status === "fixed"} gaveUp={fix?.status === "gave-up"} reported={runs.length > 0} unsure={kind === "unsure"} />}

      {detail.status === "error" && <p className="mt-8 text-bad">{detail.message}</p>}
      {detail.status === "loading" && <span className={`${bone} mt-8 block aspect-video w-full rounded-lg`} />}
      {detail.status === "ok" && (
        <section className="mt-6">
          {working && <LiveRun repo={repo} pr={pr} />}
          {waitingForFix && (
            <p className="mb-6 text-dim">Kane caught it. {fixerName(pull)} starts on a fix in a few seconds; the page follows along by itself.</p>
          )}
          {kind === "failed" && !fix && !waitingForFix && (
            <p className="mb-6 text-dim">
              No fix followed. When {fixerName(pull)} can't run,{" "}
              <a href={pull?.url} className={link}>
                the report on GitHub
              </a>{" "}
              says why.
            </p>
          )}
          {runs.length > 0 && (
            <>
              {working && <h2 className="mb-3 mt-9 text-[13px] font-medium text-faint">The last report</h2>}
              <Scenarios runs={runs} at={at} scenario={undefined} />
            </>
          )}
          {!working && runs.length === 0 && <p className="text-dim">{detail.data.pull.headline}</p>}
        </section>
      )}

      {pull && !busy && (
        <p className="mt-10 text-dim">
          This ran on a real pull request:{" "}
          <a href={pull.url} className={link}>
            the report, the clips and {fixerName(pull)}'s commit are on GitHub
          </a>
          .{" "}
          <To go={go} className={`rounded ${link}`}>
            Open another one
          </To>
          .
        </p>
      )}
    </main>
  );
}

export function Try() {
  const [pr, go] = useTryRoute();
  const [load, reload] = useLoad<TryView>("/api/try", 6_000);
  useEffect(() => {
    document.title = "Break it yourself · Proofed";
  }, []);

  return (
    <>
      <Top />
      {load.status === "error" && <p className="mx-auto max-w-3xl px-4 pt-12 text-bad sm:px-8">{load.message}</p>}
      {load.status === "loading" && (
        <div className="mx-auto max-w-3xl px-4 pt-12 sm:px-8" aria-busy="true" aria-label="Loading">
          <span className={`${bone} block h-10 w-3/5`} />
          <span className={`${bone} mt-10 block h-64 w-full rounded-xl`} />
        </div>
      )}
      {load.status === "ok" && (pr ? <Run key={pr} repo={load.data.repo} pr={pr} go={go} /> : <Picker view={load.data} go={go} reload={reload} />)}
    </>
  );
}
