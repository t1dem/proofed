import type { Command } from "./args.ts";

const MAIN = `proofed: check web, mobile and Electron scenarios with Kane CLI.

Usage
  proofed check --json               Run affected scenarios; spends Kane credits
  proofed check --only <id> --json   Run one scenario from proofed list
  proofed check "<behavior>" --json  Check a behavior no scenario covers
  add --dry-run to any check         Plan it with its credit estimate; free
  proofed list --json                Which scenarios a change touches, and their cost; free
  proofed doctor --json              Setup problems and fixes; check runs its own; free
  proofed <command> --help           All flags and JSON fields
  proofed --version

Setup
  Node 22.18+, Kane CLI signed in; Chrome for web and Electron, ffmpeg for clips.
  Local mobile needs Apple Silicon macOS; cloud mobile needs a TestMu real-device plan.
  Install: npm install -g proofed-cli | pnpm add -g proofed-cli | bun add -g proofed-cli
  Without installing: npx proofed-cli | pnpm dlx proofed-cli | bunx proofed-cli
  Update: npm install -g proofed-cli@latest.
  Uninstall: npm uninstall -g proofed-cli.
  App settings come from flags, env, .proofed/config.json, or the Proofed workflow.

Results
  JSON stdout is one document; progress is on stderr, details in .proofed-out/.
  Exit 0: passed or nothing to run; 1: failed; 2: not_checked or error; 3: setup/usage;
  130: interrupted. not_checked is not a pass. Fix error.fix for exit 3.
  On failed, read reason and diagnosis, fix the cause, then run rerun.
  failedCheck: "scenario_doubted" is Kane's opinion; review the scenario before editing it.
  A first web run is estimated at 30 credits per scenario, 1 to 4 minutes.
  Mobile/Electron cost is unknown without history. Web runs up to 3 at a time by default; other targets serially.
  Cached passes cost nothing. Use --no-cache to run them again.
  Use --no-retry when another paid attempt is forbidden.
  Give checks at least 10 minutes; don't interrupt them.`;

const CHECK = `proofed check [text] [flags]

Runs the scenarios the local change touches with Kane and says what broke.
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
  --build <cmd>         Builds before --serve, or before mobile/Electron checks (env PROOFED_BUILD)
  --install <cmd>       Installs the app's dependencies before the build, when node_modules is
                        missing or older than package.json or the lockfile (env PROOFED_INSTALL;
                        default: the workflow's install, else the app's package manager)
  --reuse               With a build set, a URL that already answers stops the check (exit 3): it
                        may be an old build. --reuse tests what is running; its passes aren't cached
  --serve-timeout <s>   How long the URL gets to answer after --serve (default 60)

Target (flag, env, scenario, config, workflow, default)
  --target <kind>       web (default), ios, android or experimental desktop; filters scenario files
  --execution <kind>    local (default) or cloud (mobile only)
  --app <path|APP…>     Mobile artifact/APP ID or desktop executable
  --device <name>       Exact mobile device name
  --os-version <v>      Mobile OS version
  --launch <cmd>        Owned desktop launch command with remote debugging
  --cdp-endpoint <url>  Desktop browser CDP endpoint; requires launch, app or --reuse
  Local mobile: Apple Silicon macOS. Cloud mobile: TestMu real-device automation plan.
  Target env vars: PROOFED_TARGET, PROOFED_EXECUTION, PROOFED_APP, PROOFED_DEVICE,
  PROOFED_OS_VERSION, PROOFED_LAUNCH, PROOFED_CDP_ENDPOINT.

Running
  --dry-run             Show what would run and the credit estimate; spends nothing
  --no-cache            Run scenarios whose pass is cached, too
  --no-retry            One attempt per scenario, including infrastructure errors and doubted checks
  --concurrency <n>     Web scenarios at a time (default 3, env PROOFED_CONCURRENCY); other targets serial
  --headed              Show Chrome
  --out <dir>           Clips, logs, cache and result.json (default .proofed-out, env PROOFED_OUT)
  --verbose             Also print Kane's steps and Chrome's log (always in <out>/run.log)
  --json                stdout gets one JSON document and nothing else

JSON (also written to <out>/result.json)
  ok, exitCode, summary, counts {passed, failed, not_checked, error, skipped}, base, url,
  changedFiles, out, dryRun, app ("started" | "reused" | null), credits, estimatedCredits, seconds, next, rerun (re-runs
  everything that didn't pass),
  skipped [{id, name, why}], scenarios [{id, name, file, outcome, cached, cachedAt, objective,
  target, recordingNote, reason, notChecked ("nothing_asserted" | "scenario_doubted" |
  "runs_disagreed" | "text_contradicted"), failedCheck ("scenario_doubted"),
  diagnosis (Kane's opinion), suggestion,
  failedStep, steps [{remark, failed}], pageError, clip {mp4, jpg}, kaneReport, credits, creditsSource ("kane_estimate"), accountBalance {before, after, debit},
  estimatedCredits, seconds, rerun}]
  failedCheck is only set on failed checks Kane blames on the scenario. suggestion gives the
  conditional next step: if the app change was intended, update the scenario; otherwise fix the app.
  credits is Kane’s estimate, not an attributed account debit.
  First web estimate: 30 credits; mobile/Electron estimatedCredits is null without history.
  accountBalance is the whole account debit; attribution to this scenario is unknown.
  Interrupted runs can spend unreported credits.
  Proofed couldn't run: {ok: false, exitCode: 3, error: {code, message, fix}}
  Interrupted: the same shape with exitCode 130 and scenarios [...] for what had finished

Before anything is built, the Kane login is checked with TestMu (kane-cli balance, free): without
one the check stops with exit 3 and error.code "kane_not_signed_in"; with LT_USERNAME and
LT_ACCESS_KEY that TestMu rejects, error.code "kane_keys_rejected".

Exit codes: 0 passed, 1 failed, 2 not_checked or error, 3 couldn't run, 130 interrupted.`;

const LIST = `proofed list [flags]

Every scenario with its id, name, start URL and paths, whether the local change touches it, and
whether a pass of it is cached. A file that doesn't parse is shown with its error (exit 3).
Spends nothing. JSON includes selected and estimatedCredits per scenario, plus the total.
Untouched scenarios and cached passes cost zero; first web runs are estimated at 30 credits.
Mobile/Electron estimatedCredits is null without history.

  Target flags and their environment variables: as for proofed check.
  --base <rev>          Compare against this (default: the remote's default branch)
  --url <url>           The app's URL, for the cache (default: as proofed check finds it)
  --scenarios <dir>     Default .proofed/scenarios
  --out <dir>           Where the cache is (default .proofed-out)
  --json                One JSON document: {ok, exitCode, base, url, estimatedCredits, scenarios [...], errors [{file, message}]}`;

const DOCTOR = `proofed doctor [flags]

Checks Node, git, the scenarios, Kane CLI (installed, signed in, credits left) and target setup.
Web checks include Chrome, optional ffmpeg and where the app is. Mobile checks inspect artifacts
and local tools/devices; desktop checks inspect CDP. Installs and launches nothing. Every
problem comes with the command or step that fixes it. Uses only Kane's free commands.
Exit 0 when proofed check can run, else 3.

  Target flags and their environment variables: as for proofed check.
  --url, --serve, --build, --install   As for proofed check
  --scenarios <dir>                    Default .proofed/scenarios
  --json                               {ok, exitCode, checks [{name, status: ok | warn | fail, detail, fix}]}`;

export const helpText = (command?: Command) => (command === "check" ? CHECK : command === "list" ? LIST : command === "doctor" ? DOCTOR : MAIN);
