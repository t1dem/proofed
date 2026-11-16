import type { Command } from "./args.ts";

const MAIN = `proofed: check a web app in real Chrome with Kane CLI before you call a change done.
It runs the plain-English scenarios in .proofed/scenarios/ that your local change touches.

Usage
  proofed check [text] [flags]   Run the scenarios the local change touches, or check just [text]
  proofed list [flags]           Every scenario: does the change touch it, is a pass cached
  proofed doctor [flags]         Is Kane CLI (and its login), Chrome, ffmpeg and the app ready
  proofed <command> --help       The flags of one command
  proofed --version

Install (macOS and Linux; Node 22.18+ is required, including with bun)
  npm install -g proofed-cli    pnpm add -g proofed-cli    bun add -g proofed-cli
  Run without installing: npx proofed-cli | pnpm dlx proofed-cli | bunx proofed-cli
  Update: npm install -g proofed-cli@latest | pnpm add -g proofed-cli@latest | bun add -g proofed-cli@latest
  Uninstall: npm uninstall -g proofed-cli | pnpm remove -g proofed-cli | bun remove -g proofed-cli
  Pick one manager. The command runs on Node, with bun too.

Usual runs, in the app's repo
  proofed check                  url and serve come from the Proofed workflow, if the repo has one
  proofed check --url http://localhost:5173 --serve "npm run dev"
  proofed check "the promo code welcome10 takes 10% off"
  proofed check --only free-shipping

Time and credits
  A scenario takes 1 to 4 minutes; 3 run at a time. A first run is estimated at 30 Kane credits.
  Credits are what Kane reported, not the account balance change, which can be slightly higher.
  An interrupted run can spend credits before Kane reports them.
  A passed scenario isn't run again (0 credits, shown as "cached") until its file, the URL, or a
  changed file in its paths changes. --dry-run shows what would run and the estimate, for free.
  --no-cache runs them anyway.

Outcomes
  passed        Kane checked what the scenario says, and it held
  failed        A scenario's check did not hold on the page. Review the failure and fix it.
                When Kane blames the scenario for it, the scenario is run a second time, at
                its cost again, and the second run is the result.
  not_checked   Kane asserted nothing, or thinks the scenario text is wrong. Not a pass.
  error         Kane couldn't finish, even on one automatic retry (browser or service trouble).
                Says nothing about the app.

Exit codes
  0    everything that ran passed, or nothing needed to run
  1    at least one scenario failed
  2    nothing failed, but at least one was not_checked or error
  3    Proofed couldn't run: usage, setup (such as no Kane login), app not reachable
  130  interrupted

For AI agents
  After changing UI code, run: proofed check --json
  Give the command a timeout of at least 10 minutes, and don't interrupt it.
  stdout is one JSON document (progress goes to stderr); see proofed check --help.
  On "failed", read reason and diagnosis, then run "rerun" after fixing the cause.
  failedCheck: "scenario_doubted" means the check failed but Kane believes it is out of date.
  Diagnosis is Kane's opinion. If the app change was intended, update the scenario; otherwise fix the app.
  Never treat "not_checked" as a pass: fix the scenario or tell the user why Kane doubts it.
  On "error", run the "rerun" command once more. On exit 3, do what error.fix says; running the
  same command again without that won't help. kane_not_signed_in needs the user: kane-cli login.`;

const CHECK = `proofed check [text] [flags]

Runs the scenarios the local change touches, in Chrome, with Kane, and says what broke.
The local change: files that differ from the merge base with --base, committed or not, plus new
files git doesn't ignore. Nothing changed: nothing runs (exit 0). Not a git repo: every scenario runs.
With [text], Kane checks just that, e.g. proofed check "the cart total updates when I press +".

Which scenarios
  --base <rev>          Compare against this (default: origin/HEAD, origin/main, origin/master, main, master)
  --only <id,id>        Exactly these (ids from proofed list)
  --all                 Every scenario
  --scenarios <dir>     Where they are (default .proofed/scenarios, env PROOFED_SCENARIOS)

Where the app is (flag, then env, then .proofed/config.json, then the Proofed workflow step)
  --url <url>           Where it runs (env PROOFED_URL), e.g. http://localhost:5173
  --serve <cmd>         Starts it when the URL doesn't answer; stopped at the end (env PROOFED_SERVE)
  --build <cmd>         Runs before --serve (env PROOFED_BUILD)
  --install <cmd>       Installs the app's dependencies before the build, when node_modules is
                        missing or older than package.json or the lockfile (env PROOFED_INSTALL;
                        default: the workflow's install, else the app's package manager)
  --reuse               With a build set, a URL that already answers stops the check (exit 3): it
                        may be an old build. --reuse tests what is running; its passes aren't cached
  --serve-timeout <s>   How long the URL gets to answer after --serve (default 60)

Running
  --dry-run             Show what would run and the credit estimate; spends nothing
  --no-cache            Run scenarios whose pass is cached, too
  --concurrency <n>     Scenarios at a time (default 3)
  --headed              Show Chrome
  --out <dir>           Clips, logs, cache and result.json (default .proofed-out, env PROOFED_OUT)
  --verbose             Also print Kane's steps and Chrome's log (always in <out>/run.log)
  --json                stdout gets one JSON document and nothing else

JSON (also written to <out>/result.json)
  ok, exitCode, summary, counts {passed, failed, not_checked, error, skipped}, base, url,
  app ("started" | "reused"), credits, estimatedCredits, seconds, next, rerun (re-runs
  everything that didn't pass),
  skipped [{id, name, why}], scenarios [{id, name, file, outcome, cached, cachedAt, objective,
  reason, notChecked ("nothing_asserted" | "scenario_doubted"), failedCheck ("scenario_doubted"),
  diagnosis (Kane's opinion), suggestion,
  failedStep, steps [{remark, failed}], pageError, clip {mp4, jpg}, credits, seconds, rerun}]
  failedCheck is only set on failed checks Kane blames on the scenario. suggestion gives the
  conditional next step: if the app change was intended, update the scenario; otherwise fix the app.
  credits is the sum Kane reported, not the balance change; the balance can drop slightly more.
  First-run estimate: 30 credits. An interrupted run can spend credits before reporting them.
  Proofed couldn't run: {ok: false, exitCode: 3, error: {code, message, fix}}
  Interrupted: the same shape with exitCode 130 and scenarios [...] for what had finished

Before anything is built, the Kane login is checked (kane-cli whoami, free): without one the
check stops with exit 3 and error.code "kane_not_signed_in".

Exit codes: 0 passed, 1 failed, 2 not_checked or error, 3 couldn't run, 130 interrupted.`;

const LIST = `proofed list [flags]

Every scenario with its id, name, start URL and paths, whether the local change touches it, and
whether a pass of it is cached. A file that doesn't parse is shown with its error (exit 3).
Spends nothing.

  --base <rev>          Compare against this (default: the remote's default branch)
  --url <url>           The app's URL, for the cache (default: as proofed check finds it)
  --scenarios <dir>     Default .proofed/scenarios
  --out <dir>           Where the cache is (default .proofed-out)
  --json                One JSON document: {ok, exitCode, base, url, scenarios [...], errors [{file, message}]}`;

const DOCTOR = `proofed doctor [flags]

Checks Node, git, the scenarios, Kane CLI (installed, signed in, credits left), Chrome, ffmpeg
(optional: without it there are no clips, the verdicts still work) and where the app is. Every
problem comes with the command or step that fixes it. Uses only Kane's free commands.
Exit 0 when proofed check can run, else 3.

  --url, --serve, --build, --install   As for proofed check
  --scenarios <dir>                    Default .proofed/scenarios
  --json                               {ok, exitCode, checks [{name, status: ok | warn | fail, detail, fix}]}`;

export const helpText = (command?: Command) => (command === "check" ? CHECK : command === "list" ? LIST : command === "doctor" ? DOCTOR : MAIN);
