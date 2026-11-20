import { useRef, useState, type ReactNode } from "react";
import { modelLabel, providerOf } from "../worker/models";
import type { ActivityRun } from "../worker/runs";
import { tally, type Day, type Tally } from "./activity";
import { ago, useLoad } from "./lib";
import { ClaudeMark, CodexMark } from "./SettingsMarks";
import { bone, focus, marks, PageTitle, RepoChip, Segmented, soft } from "./ui";

type Days = 7 | 30 | 90;
const RANGES: { value: `${Days}`; label: string }[] = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

const whole = new Intl.NumberFormat("en-US");
const count = (n: number) => (n >= 10_000 ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n) : whole.format(n));
const percent = (share: number) => `${Math.round(share * 100)}%`;
function duration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
}
const dayName = (start: number, long = false) =>
  new Date(start).toLocaleDateString("en-US", long ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric" });

// The change against the period before: the arrow and size, coloured only where up is plainly
// good or bad (more runs or credits is neither).
type Delta = { text: string; tone: string } | undefined;
function change(now: number, before: number, good?: "up"): Delta {
  if (before === 0 || now === before) return undefined;
  const up = now > before;
  const tone = good ? (up ? "text-ok" : "text-bad") : "text-dim";
  return { text: `${up ? "↑" : "↓"} ${Math.round((Math.abs(now - before) / before) * 100)}%`, tone };
}
function points(now: number | null, before: number | null): Delta {
  if (now === null || before === null) return undefined;
  const diff = Math.round((now - before) * 100);
  if (diff === 0) return undefined;
  return { text: `${diff > 0 ? "↑" : "↓"} ${Math.abs(diff)} pts`, tone: diff > 0 ? "text-ok" : "text-bad" };
}

// Sections stand on the page with a heading each, no box around them; only the figures share one.
const heading = "text-[15px] font-semibold tracking-[-0.01em]";
const note = "mt-0.5 text-[13px] text-faint";

function Stat({ label, value, sub, delta, days }: { label: string; value: string; sub: ReactNode; delta: Delta; days: Days }) {
  return (
    <div className="bg-bg px-5 py-4 md:py-5">
      <p className="text-[13px] text-dim">{label}</p>
      <p className="mt-2 flex items-baseline gap-2">
        <span className="text-[30px] font-semibold leading-9 tracking-[-0.025em]">{value}</span>
        {delta && (
          <span className={`text-[13px] font-medium tabular-nums ${delta.tone}`} title={`Against the ${days} days before`}>
            {delta.text}
          </span>
        )}
      </p>
      <p className="mt-1 truncate text-[13px] text-faint">{sub}</p>
    </div>
  );
}

// Runs a day, each column split by how its runs came out. A clean step on the axis: 1, 2 or 5 times a power of ten.
const SERIES = [
  // Passing is the usual: it stays quiet, so the breaks are what the eye finds.
  { key: "passed", ...marks.passed, fill: "bg-fg/[0.16]" },
  { key: "unsure", ...marks.unsure },
  { key: "broke", ...marks.failed },
] as const;

function niceMax(n: number) {
  if (n <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(n / 2));
  const half = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => s * 2 >= n)!;
  return half * 2;
}

function RunsChart({ daily }: { daily: Day[] }) {
  const [at, setAt] = useState<number>();
  const top = niceMax(Math.max(...daily.map((d) => d.passed + d.broke + d.unsure)));
  // Every day on a week, then about six dates along the axis; today is always one.
  const every = daily.length <= 7 ? 1 : Math.ceil(daily.length / 6);
  const shown = at === undefined ? undefined : daily[at];
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 className={heading}>Runs a day</h2>
        <ul className="flex gap-3.5 text-[12px] text-dim">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${s.fill}`} />
              {s.label}
            </li>
          ))}
        </ul>
      </div>
      <div className="relative mt-5 flex h-44 gap-2 pl-7" onPointerLeave={() => setAt(undefined)}>
        {/* The axis: three hairlines and their values. */}
        {[1, 0.5, 0].map((f) => (
          // A zero-height row, so the hairline lies exactly at its value and the bars stand on the bottom one.
          <div key={f} className="pointer-events-none absolute inset-x-0 flex h-0 items-center gap-2" style={{ bottom: `calc(${f} * (100% - 1.25rem) + 1.25rem)` }}>
            <span className="w-5 text-right text-[11px] tabular-nums text-faint">{top * f}</span>
            <span className={`h-px flex-1 ${f === 0 ? "bg-edge" : "bg-edge/60"}`} />
          </div>
        ))}
        <div className="relative flex flex-1 items-stretch">
          {daily.map((day, i) => {
            const total = day.passed + day.broke + day.unsure;
            const parts = SERIES.filter((s) => day[s.key] > 0);
            const nth = (daily.length - 1 - i) / every;
            const label = Number.isInteger(nth);
            // A phone has room for every other date of a month or a quarter.
            const phoneSkips = daily.length > 7 && nth % 2 === 1;
            return (
              <div
                key={day.start}
                tabIndex={0}
                aria-label={`${dayName(day.start, true)}: ${total} runs, ${day.passed} passed, ${day.unsure} not confirmed, ${day.broke} broke`}
                onPointerEnter={() => setAt(i)}
                onFocus={() => setAt(i)}
                onBlur={() => setAt(undefined)}
                className="group relative flex min-w-0 flex-1 flex-col items-center justify-end outline-none"
              >
                <div className="flex h-[calc(100%-1.25rem)] w-full flex-col justify-end px-[12%]">
                  <div
                    className={`mx-auto flex w-full max-w-[18px] flex-col-reverse gap-[2px] transition-opacity ${at !== undefined && at !== i ? "opacity-50" : ""}`}
                    style={{ height: `${(total / top) * 100}%` }}
                  >
                    {parts.map((s, j) => (
                      <span key={s.key} className={`min-h-[2px] ${s.fill} ${j === parts.length - 1 ? "rounded-t-[3px]" : ""}`} style={{ flexGrow: day[s.key] }} />
                    ))}
                  </div>
                </div>
                {/* Out of the flow, so a date never widens its column; the last one keeps inside the card. */}
                <span className="h-5" />
                {label && (
                  <span
                    className={`absolute bottom-0 h-5 whitespace-nowrap pt-1.5 ${phoneSkips ? "max-md:hidden" : ""} text-[11px] leading-none tabular-nums text-faint ${i === daily.length - 1 && daily.length > 7 ? "right-0" : "left-1/2 -translate-x-1/2"}`}
                  >
                    {daily.length <= 7 ? new Date(day.start).toLocaleDateString("en-US", { weekday: "short" }) : dayName(day.start)}
                  </span>
                )}
                <span className="pointer-events-none absolute inset-x-0 bottom-5 top-0 rounded-md group-focus-visible:ring-2 group-focus-visible:ring-work/40" />
              </div>
            );
          })}
          {shown && at !== undefined && (
            <div
              role="status"
              className="pointer-events-none absolute -top-2 z-10 w-44 rounded-lg border border-edge bg-panel p-2.5 text-[12px] shadow-xl shadow-black/30"
              style={at < daily.length / 2 ? { left: `calc(${((at + 1) / daily.length) * 100}% + 6px)` } : { right: `calc(${((daily.length - at) / daily.length) * 100}% + 6px)` }}
            >
              <p className="font-medium text-fg">{dayName(shown.start, true)}</p>
              <ul className="mt-1.5 space-y-1">
                {[...SERIES].reverse().map((s) => (
                  <li key={s.key} className="flex items-center gap-2">
                    <span className={`h-0.5 w-2.5 rounded-full ${s.fill}`} />
                    <span className="flex-1 text-dim">{s.label}</span>
                    <span className="font-medium tabular-nums text-fg">{shown[s.key]}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 flex justify-between border-t border-edge pt-1.5 text-dim">
                Credits <span className="font-medium tabular-nums text-fg">{whole.format(shown.credits)}</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// A thin bar for a share: one row of a list, with its figures in text beside it.
function Share({ part, of, fill }: { part: number; of: number; fill: string }) {
  return (
    <span className="block h-1 overflow-hidden rounded-full bg-fg/[0.07]">
      <span className={`block h-full rounded-full ${fill}`} style={{ width: of ? `${(part / of) * 100}%` : 0 }} />
    </span>
  );
}

function Fixers({ t }: { t: Tally }) {
  return (
    <section>
      <h2 className={heading}>Fix requests</h2>
      <p className={note}>
        {t.fixes.tried ? `${t.fixes.tried} asked, ${t.fixes.attempts} attempts in all` : "No fixes were asked for in this period."}
      </p>
      <ul className="mt-4 space-y-4">
        {t.models.map((m) => (
          <li key={m.model}>
            <div className="flex items-center gap-2 text-[13px]">
              <span className="grid w-4 place-items-center">{providerOf(m.model) === "codex" ? <CodexMark size={14} /> : <ClaudeMark size={14} />}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{modelLabel(m.model)}</span>
              <span className="tabular-nums text-dim">
                <span className="text-fg">{m.fixed}</span> of {m.tries} fixed · {m.attempts} attempts
              </span>
            </div>
            <div className="mt-2 pl-6">
              <Share part={m.fixed} of={m.tries} fill="bg-ok" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Breaking({ t, onScenario }: { t: Tally; onScenario: (repo: string, name: string) => void }) {
  return (
    <section>
      <h2 className={heading}>Breaks most</h2>
      <p className={note}>{t.breaking.length ? "Scenarios by how often they failed" : "No scenario failed in this period."}</p>
      <ul className="mt-3 -mx-2">
        {t.breaking.map((s) => (
          <li key={`${s.repo}\n${s.name}`}>
            <button
              type="button"
              onClick={() => onScenario(s.repo, s.name)}
              title="Show its pull requests in the Inbox"
              className={`w-full rounded-lg px-2 py-2 text-left hover:bg-hover/60 ${soft} ${focus}`}
            >
              <span className="flex items-center gap-2 text-[13px]">
                <RepoChip repo={s.repo} size={16} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{s.name}</span> <span className="text-faint">{s.repo.split("/")[1]}</span>
                </span>
                <span className="tabular-nums text-dim">
                  <span className="text-fg">{s.failed}</span> of {s.runs} runs
                </span>
              </span>
              <span className="mt-2 block pl-6">
                <Share part={s.failed} of={s.runs} fill="bg-bad" />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Repos({ t, onRepo }: { t: Tally; onRepo: (repo: string) => void }) {
  const cols = "grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-center gap-x-3 md:grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem_5.5rem_5.5rem]";
  return (
    <section>
      <h2 className={heading}>Repositories</h2>
      <div role="table" aria-label="Repositories" className="-mx-3 mt-3 text-[13px]">
        <div role="row" className={`${cols} mx-3 mb-1 border-b border-edge pb-2 text-[12px] font-medium text-faint`}>
          <span role="columnheader">Repository</span>
          <span role="columnheader" className="text-right">Runs</span>
          <span role="columnheader" className="text-right">Broke</span>
          <span role="columnheader" className="text-right max-md:hidden">Fixed</span>
          <span role="columnheader" className="text-right max-md:hidden">Credits</span>
          <span role="columnheader" className="text-right max-md:hidden">Last run</span>
        </div>
        {t.repos.map((r) => (
          <button
            key={r.repo}
            role="row"
            type="button"
            onClick={() => onRepo(r.repo)}
            title="Show its pull requests in the Inbox"
            className={`${cols} w-full rounded-lg px-3 py-2.5 text-left tabular-nums hover:bg-hover/60 ${soft} ${focus}`}
          >
            <span role="cell" className="flex min-w-0 items-center gap-2.5">
              <RepoChip repo={r.repo} />
              <span className="truncate font-medium">{r.repo.split("/")[1]}</span>
            </span>
            <span role="cell" className="text-right">{whole.format(r.runs)}</span>
            <span role="cell" className={`text-right ${r.broke ? "text-fg" : "text-faint"}`}>{whole.format(r.broke)}</span>
            <span role="cell" className={`text-right max-md:hidden ${r.fixed ? "text-fg" : "text-faint"}`}>{whole.format(r.fixed)}</span>
            <span role="cell" className="text-right max-md:hidden">{whole.format(r.credits)}</span>
            <span role="cell" className="text-right text-dim max-md:hidden">{ago(r.last)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="mt-6 space-y-10" aria-busy="true" aria-label="Loading">
      <span className={`${bone} block h-[118px] rounded-xl`} />
      <span className={`${bone} block h-56 rounded-xl`} />
    </div>
  );
}

type DashboardProps = { onRepo: (repo: string) => void; onScenario: (repo: string, name: string) => void };

// What Proofed has been doing across your repositories: how much it ran and what it cost, how
// the runs came out, what the fixers were asked and managed, and where things break.
export function Dashboard({ onRepo, onScenario }: DashboardProps) {
  const [days, setDays] = useState<Days>(30);
  const [load] = useLoad<ActivityRun[]>(`/api/activity?days=${days}`);
  // Switching the range keeps the last numbers on screen, dimmed, until the new ones are in.
  const last = useRef<{ days: Days; runs: ActivityRun[] }>(undefined);
  if (load.status === "ok") last.current = { days, runs: load.data };
  const shown = last.current;
  const t = shown && tally(shown.runs, shown.days);
  const stale = load.status !== "ok";
  const period = <Segmented label="Period" value={`${days}`} options={RANGES} onChange={(v) => setDays(Number(v) as Days)} />;

  return (
    <main className="mx-auto max-w-6xl px-4 pb-8 sm:px-8 md:py-7">
      {/* On a phone the title is the top bar, too narrow for the period: it goes under the bar instead. */}
      <PageTitle aside={<div className="max-md:hidden">{period}</div>}>Dashboard</PageTitle>
      <div className="mt-4 md:hidden">{period}</div>
      {load.status === "error" && <p className="mt-6 text-bad">{load.message}</p>}
      {!t && load.status !== "error" && <Skeleton />}
      {t && shown && (
        <div className={`mt-6 space-y-10 transition-opacity max-md:mt-4 max-md:space-y-8 ${stale ? "opacity-60" : ""}`}>
          {/* One strip, the figures parted by hairlines (the gap shows the border colour beneath). */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-edge bg-edge lg:grid-cols-4">
            <Stat label="Runs" value={count(t.runs)} sub={`${duration(t.seconds)} in Chrome`} delta={change(t.runs, t.runsBefore)} days={shown.days} />
            <Stat
              label="Scenarios passed"
              value={t.passRate === null ? "–" : percent(t.passRate)}
              sub={`of ${count(t.checked)} checks`}
              delta={points(t.passRate, t.passRateBefore)}
              days={shown.days}
            />
            <Stat
              label="Fixes pushed"
              value={count(t.fixes.fixed)}
              sub={t.fixes.tried ? `of ${t.fixes.tried} asked${t.fixes.gaveUp ? ` · ${t.fixes.gaveUp} gave up` : ""}` : "None asked"}
              delta={change(t.fixes.fixed, t.fixes.fixedBefore, "up")}
              days={shown.days}
            />
            <Stat
              label="Kane credits"
              value={count(t.credits)}
              sub={t.balance === undefined ? "TestMu didn't report a balance" : `${whole.format(t.balance)} left on TestMu`}
              delta={change(t.credits, t.creditsBefore)}
              days={shown.days}
            />
          </div>
          {t.runs === 0 ? (
            <div className="rounded-xl border border-dashed border-edge px-5 py-10 text-center">
              <p className="font-medium">No runs in the last {shown.days} days.</p>
              <p className="mt-1 text-dim">Runs show up here once Proofed checks a pull request.</p>
            </div>
          ) : (
            <>
              <RunsChart daily={t.daily} />
              <div className="grid gap-10 max-md:gap-8 lg:grid-cols-2 lg:gap-12">
                <Fixers t={t} />
                <Breaking t={t} onScenario={onScenario} />
              </div>
              <Repos t={t} onRepo={onRepo} />
            </>
          )}
        </div>
      )}
    </main>
  );
}
