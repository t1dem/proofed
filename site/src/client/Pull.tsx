import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { useState } from "react";
import type { PullDetail, PullView } from "../worker/runs";
import { canAskAgain, fixLabel, movingName, titleName, useLoad, type Ask, type Route, type useAsk } from "./lib";
import { LiveRun } from "./Live";
import { RunMeta } from "./PullRunMeta";
import { Scenarios } from "./PullScenarios";
import { bone, iconButton, kindOf, link, Link, MobileBar, NEEDS_WRITE, outline, PageTitle, RepoChip, solid } from "./ui";

export { RunMeta, Scenarios };

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
  const locked = { disabled: !canAskAgain(state) || !!pull?.readOnly, title: pull?.readOnly ? NEEDS_WRITE : undefined };

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
        <span className="flex items-center gap-1.5">
          <RepoChip repo={repo} size={14} />
          {repo.split("/")[1]}
        </span>
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
                  {fixLabel(pull)}
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
        {/* No status icon here: the line under the title says how the run went, and each scenario has its own. */}
        <span className="pr-title min-w-0" data-title={titleName({ repo, pr })} style={{ viewTransitionName: movingName({ repo, pr }) }}>
          {pull?.title ?? "Pull request"} <span className="font-normal text-faint">#{pr}</span>
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
                {(kind === "running" || kind === "fixing") && <h2 className="mb-6 mt-12 border-t border-edge pt-6 text-[13px] font-medium text-fg">The last report</h2>}
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
                {fixLabel(pull)}
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
