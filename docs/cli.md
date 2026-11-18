# proofed check

The reference for `proofed check`. Installing it and the three commands are in the [README](../README.md#locally-and-from-an-ai-agent).

## What it checks

The change is everything since the merge base with the default branch (`origin/HEAD`, else `origin/main`, `origin/master`, `main`, `master`, or `--base`), uncommitted and untracked files included.

## Where it finds the app

The URL and the commands that install, build and serve the app are taken from the first of these that sets them:

1. `--url`, `--install`, `--build`, `--serve`
2. `PROOFED_URL`, `PROOFED_INSTALL`, `PROOFED_BUILD`, `PROOFED_SERVE`
3. `.proofed/config.json`
4. the Proofed step of the repo's workflow, so a repo that already runs Proofed on its PRs needs no flags

A build or install set in config or the workflow belongs to its serve command. Overriding
`serve` also drops that layer's build/install; pass them explicitly when needed.

Before anything is built, `kane-cli balance` (free) checks that TestMu accepts the login or the `LT_USERNAME` and `LT_ACCESS_KEY`. If it doesn't, the check stops with exit 3: `kane_not_signed_in` (fix: `kane-cli login`) or `kane_keys_rejected` (the keys are wrong or expired).

If the app isn't running, Proofed starts it and stops it at the end. It installs the dependencies only when `node_modules` is missing or older than `package.json` or the lockfile (with the install command found as above, else the app's package manager), then builds, then serves. If something already answers at the URL and a build is configured, the check stops rather than test what may be an old build; `--reuse` tests it anyway.

## Caching and output

A passed scenario isn't run again until its file, the URL, the resolved target, Kane version, the base commit or a changed file in its `paths` changes. Native and desktop checks with a build command always rebuild and run again; an old artifact's pass cannot skip the build. `--dry-run` shows what would run and the credit estimate, for free. In a terminal the scenarios update in place; in a pipe each event is one line, with a "still running" line at least every 30 seconds.

## For an agent

Run the one command the task needs: `proofed check` checks its own setup first and exits 3
with `error.fix` when something is missing. For setup questions, `proofed doctor --json` lists
problems and their fixes. To ask which scenarios a change touches without planning a check,
`proofed list --json` gives each scenario's `selected`, `cached` and `estimatedCredits`, plus the total
`estimatedCredits`. A selected scenario is touched by the change, or all scenarios when
there is no Git base. A clean diff selects nothing. Untouched scenarios and cached passes cost zero. Estimates use the
last reported cost, or 30 credits for a first web run; mobile and desktop estimates are `null` without history. Invalid scenarios are in `errors`; fix
those before checking. These commands do not spend credits.

Use `proofed check --only <id> --dry-run --json` to plan one scenario, or
`proofed check "<what to check>" --dry-run --json` to plan a check of a behavior no scenario
covers. Text that is a scenario's id or name is refused with exit 3 and the `--only` command. Remove
`--dry-run` to run it. Allow at least 10 minutes. Read `reason`, `diagnosis` and `rerun`
when a scenario fails. `not_checked` is not a pass. On exit 3, follow `error.fix`.

## A sample run

A real run on the demo store with the free shipping threshold changed to €60. Kane blamed the scenario, so it ran twice, and the credits are for both runs:

```
Proofed: checking 1 of 3 scenario(s), --only, at http://localhost:4173.
Estimate: about 30 Kane credits.
Time: about 1 to 4 minutes per scenario, 3 at a time, so 1 to 4 minutes in all. Do not interrupt: let it finish.
Building the app: pnpm build
Starting the app: pnpm preview --port 4173
Started the app in 1 s (build from --build, serve from --serve); its output is in .proofed-out/serve.log
[0:01] started free-shipping: Free shipping from €50
[0:26] still running: free-shipping 0:25 at "Step 3"
[0:51] still running: free-shipping 0:50 at "Step 9"
[1:16] still running: free-shipping 1:15 at "assert: shipping is now Free and the total is €51.00."
[1:41] still running: free-shipping 1:40 at "assert: shipping is now Free and the total is €51.00."
[1:45] retrying free-shipping: the check failed, but Kane blames the scenario; running it once more to be sure
[2:11] still running: free-shipping 2:10 at "Step 3"
[2:36] still running: free-shipping 2:35 at "Step 8"
[3:01] still running: free-shipping 3:00 at "Step 10"
[3:26] still running: free-shipping 3:25 at "assert: shipping is now Free and the total is €51.00."
[3:51] failed free-shipping: Free shipping from €50 (3:50, 56.9 credits)

✗ Free shipping from €50 failed after 3:50
  Kane saw    Final verification failed: "shipping is now Free and the total is €51.00."
  Why         The scenario's check did not hold on the page, on two runs in a row. Kane believes the scenario is out of date.
  Kane thinks The test used the wrong free-shipping cutoff. After Paper Filters was increased, the basket subtotal was €51.00, which is still below the displayed €60.00 threshold, so the €4.90 shipping charge was correct.
  Next        If the change in the app was intended, update the scenario; otherwise fix the app.
  Failed step assert: shipping is now Free and the total is €51.00.
  Clip        .proofed-out/free-shipping/clip.mp4
  Scenario    .proofed/scenarios/free-shipping.md

✗ 1 failed · 56.9 credits · 3m 52s
Credits are Kane's report; balance may drop slightly more.
1 of 1 broke: Free shipping from €50
Re-run what broke: proofed check --only free-shipping --url http://localhost:4173 --serve 'pnpm preview --port 4173' --build 'pnpm build'
```

## Credits

`--no-retry` limits each selected scenario to one Kane attempt, including infrastructure errors
and checks Kane blames on the scenario. The first verdict is returned, with its usual exit code
and diagnostics. Without the flag, infrastructure errors get one retry unless Kane rejected the login. A doubted failure gets a second run, which can also retry an infrastructure error: up to four Kane attempts in total.

A first web run is estimated at 30 Kane credits per scenario. Mobile and desktop estimates are `null` without history. Later estimates use the last reported cost. Credits are Kane estimates for the runs, retries included (`creditsSource: "kane_estimate"`); the account balance can drop slightly more. An interrupted run can spend credits before Kane reports them.

When available, scenario JSON includes `accountBalance: {before, after, debit}`. This is
the whole account's balance change, with unknown attribution to the scenario. Proofed
omits it when it detects overlapping Proofed runs on the same machine; it cannot
detect other activity on the account.

## JSON and exit codes

`--json` prints one compact JSON document on stdout and the progress on stderr. Every check also writes the same fields, with indentation, to `.proofed-out/result.json`, next to the clips; the folder has its own `.gitignore`.

| Exit | Meaning |
|---|---|
| 0 | Everything checked passed, nothing needed to run, or a dry run succeeded |
| 1 | A scenario failed |
| 2 | Nothing failed, but something wasn't checked or a run errored |
| 3 | The check couldn't start. The message says why and how to fix it; running it again unchanged won't help |
| 130 | Ctrl-C or a closed terminal. Kane, Chrome and the app are stopped first |

`failedCheck: "scenario_doubted"` means a scenario's check failed, but Kane believes the scenario is out of date. `diagnosis` is Kane's opinion; `suggestion` and `next` say to update the scenario if the app change was intended, otherwise fix the app. Unless `--no-retry` is set, such a failure is run a second time, at the scenario's cost again. A check that fails both times is a failure (exit 1). A failure followed by a pass stays unconfirmed and is reported as `notChecked: "runs_disagreed"` (exit 2). `notChecked: "scenario_doubted"` means Kane doubted the scenario without a failed check (exit 2).

## Mobile and Electron targets

A scenario can select `target: web|ios|android|desktop` and `execution: local|cloud`.
Cloud execution is only for iOS and Android.
Existing scenarios default to local web checks. Each selected scenario reports its resolved
`target` and field sources in JSON. `list` also prints the target in its table.

```markdown
---
name: Counter increments
target: ios
execution: local
app: build/Counter.app
device: iPhone 17
os_version: '26.4'
---
Tap Add once. Assert that the counter reads 1.
```

Use `--target`, `--execution`, `--app`, `--device`, `--os-version`, `--launch`,
and `--cdp-endpoint` with `check`, `doctor`, or `list`. Their environment equivalents
are `PROOFED_TARGET`, `PROOFED_EXECUTION`, `PROOFED_APP`, `PROOFED_DEVICE`,
`PROOFED_OS_VERSION`, `PROOFED_LAUNCH`, and `PROOFED_CDP_ENDPOINT`.
Config and frontmatter use underscores (`os_version`, `cdp_endpoint`); action inputs
use hyphens. Each field resolves in this order: flag, environment, scenario,
`.proofed/config.json`, action inputs read from the workflow, default.
Relative app paths resolve from the app working directory.
`--target` filters scenario files; it sets the target for an ad hoc objective.
`--only` with ids from another target is an error.

- Local iOS needs an Apple Silicon Mac (macOS arm64), full Xcode, an installed simulator runtime, Kane's managed simulator
  dependencies, and exactly one matching booted device. Supply a simulator `.app` or
  `.zip`, or a Kane `APP…` ID. Proofed temporarily zips `.app` bundles for Kane.
  A device `.ipa` cannot run in Simulator.
- Local Android needs an Apple Silicon Mac (macOS arm64), Kane's managed emulator dependencies, `adb` on PATH, and exactly
  one matching online emulator. Supply an `.apk` or `APP…` ID. A local `.aab` is rejected.
  Device names and OS versions must identify the same device in Kane and adb.
- Cloud iOS uses `.ipa` or `APP…`; cloud Android uses `.apk`, `.aab`, or `APP…`.
  Kane provisions real devices; the TestMu plan must include real-device automation. Evidence is screenshot-only in Kane's session directory;
  Proofed reports a recording note and does not promise a cloud MP4.
- Desktop is experimental and limited to a single Electron Chromium page renderer.
  Set `launch` to the executable and its remote debugging arguments, and set
  `cdp_endpoint` to its browser CDP endpoint. Proofed waits for `/json/version` and
  rejects multiple page renderers. An already running app requires `--reuse` with no
  `launch`; Proofed never terminates that app. Owned launch processes run in their own
  process group. Alternatively, set `app` to the desktop executable or macOS `.app` bundle;
  Proofed adds the debugging port from `cdp_endpoint`. Clip rendering uses a separate Proofed Chrome.

```markdown
---
name: Desktop counter
target: desktop
launch: ./dist/Counter --remote-debugging-port=9223
cdp_endpoint: http://127.0.0.1:9223
---
Click Add once. Assert that the counter reads 1.
```

`doctor` discovers tools and devices without installing, downloading, launching, or
booting anything. Every target check includes a fix line in JSON. Missing build output
is reported as `artifact_pending_build` when a build command is configured. `check`
builds before validating the artifact. `--dry-run` resolves scenarios and reads cache
metadata; it never starts a device or Kane scenario. Both commands can call Kane's
free `--version` command. Local mobile checks refuse to run with missing managed deps,
since Kane can otherwise download them automatically.

After installing the SDK and managed dependencies explicitly, choose a device from the
local inventory, boot it yourself, and run:

```sh
kane-cli doctor --target simulator --install
xcrun simctl list devices available
xcrun simctl boot '<simulator-udid>'
xcrun simctl bootstatus '<simulator-udid>' -b
proofed doctor --target ios --app build/Counter.app --device 'iPhone 17' --os-version 26.4
proofed check --target ios --all --app build/Counter.app --device 'iPhone 17' --os-version 26.4

kane-cli doctor --target emulator --install
emulator -list-avds
emulator -avd '<avd-name>'
adb devices
proofed doctor --target android --app app/build/outputs/apk/debug/app-debug.apk --device '<device-name>' --os-version '<version>'
proofed check --target android --all --app app/build/outputs/apk/debug/app-debug.apk --device '<device-name>' --os-version '<version>'
```

Run the emulator command in a separate terminal. Supply names and versions from your
actual inventory; the examples do not install a runtime or choose a device for you.

Native recording uses `simctl recordVideo` or `adb shell screenrecord`. Android segments
are limited to 175 seconds and concatenated after pulling them. ffmpeg produces MP4,
final JPG and GIF without changing portrait orientation or adding a cursor or zoom.
Segment boundaries may have a gap. A recording failure is reported separately and
preserves Kane's verdict. Cloud recordings are not available through this adapter.
Only Proofed's remote recording files are removed, after a successful pull.

No target supports direct Safari automation. Tauri and WKWebView are unsupported.
Electron coverage excludes native desktop menus, OS file dialogs and tray UI.
Kane may upload app artifacts to the TestMu account even for a local run. Mobile
cost remains unknown until the first run reports `credits_consumed`; JSON uses `null`
for mobile and desktop targets without history. Web scenarios fall back to 30 credits. History is separate by app digest, device, OS and Kane version.
Doubted failures use the same retry rules as web checks; `--no-retry` permits one attempt.

Fixing uses the same checkbox, `/proofed fix` command and **Fix automatically** setting
on every target. Set `build` to produce the artifact named by `app`, or the desktop
app started by `launch`. Every attempt rebuilds, then Kane re-checks through the normal
target preparation. Local mobile installs the rebuilt artifact; cloud mobile uploads
changed artifact bytes and starts a fresh device session; desktop launches a new process.
Kane keys its upload cache by the artifact SHA-256, platform, account and environment,
so an identical rebuild may reuse that upload; a changed artifact gets a new upload.
The final check reuses this job's last attempt results when the tree is unchanged,
including native results. It rebuilds and runs only missing scenarios; a changed tree
requires checking the full selection again. If every result is already known, it skips
the build and Kane. Verification finishes before committing and pushing. These checks
never use a pass from the CLI cache. Only web scenarios start the HTTP server,
so native and desktop jobs need no `url` or `serve`.

A pre-uploaded `APP…` ID cannot receive a rebuild. A desktop `cdp_endpoint` without
`launch` or `app` cannot be restarted. These cases, and a non-web target without a
build command, get a “Fix didn't run” note instead of an offered fix. Ordinary checks
of uploaded IDs and explicitly reused desktop sessions still work.

### GitHub Actions examples

Use the PR/comment triggers, permissions and concurrency from the [README workflow](../README.md#setup).
Pass `vars: ${{ toJSON(vars) }}` to carry the dashboard's **Fix automatically** setting.
Set the matching `target` in the scenario frontmatter; the action's `target` input
filters scenario files. Prepare SDKs and devices before the action; Proofed installs
none of them.
To use a ChatGPT plan, save the contents of `~/.codex/auth.json` after `codex login` as
`CODEX_AUTH_JSON` and pass `codex-auth-json: ${{ secrets.CODEX_AUTH_JSON }}` with `codex-api-key` empty.

Android cloud on Ubuntu builds an APK locally and gives Kane its path for each check. This
needs a TestMu plan with real-device automation; an Ubuntu emulator is not a supported
Kane local target.

```yaml
runs-on: ubuntu-latest
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-java@v4
    with: { distribution: temurin, java-version: '17' }
  - uses: android-actions/setup-android@v3
  - uses: t1dem/proofed@main
    with:
      target: android
      execution: cloud
      build: ./gradlew :app:assembleDebug
      app: app/build/outputs/apk/debug/app-debug.apk
      device: Pixel 8
      os-version: '14'
      lt-username: ${{ secrets.LT_USERNAME }}
      lt-access-key: ${{ secrets.LT_ACCESS_KEY }}
      codex-api-key: ${{ secrets.CODEX_API_KEY }}
      vars: ${{ toJSON(vars) }}
```

Local Android can use a self-hosted Apple Silicon Mac with Java 17, Android SDK,
Kane's managed dependencies and a matching emulator already booted. Replace the device
name and version with that runner's inventory. Local iOS uses the same runner class
with Xcode and a booted simulator.

```yaml
runs-on: [self-hosted, macOS, ARM64]
steps:
  - uses: t1dem/proofed@main
    with:
      target: android
      execution: local
      build: ./gradlew :app:assembleDebug
      app: app/build/outputs/apk/debug/app-debug.apk
      device: Pixel 8 API 35
      os-version: '15'
      lt-username: ${{ secrets.LT_USERNAME }}
      lt-access-key: ${{ secrets.LT_ACCESS_KEY }}
      codex-api-key: ${{ secrets.CODEX_API_KEY }}
      vars: ${{ toJSON(vars) }}
```

Electron on macOS: Proofed launches and stops the app for each check. The build must
produce the code loaded by `main.js`.

```yaml
runs-on: macos-latest
steps:
  - uses: t1dem/proofed@main
    with:
      target: desktop
      install: npm ci
      build: npm run build
      launch: "./node_modules/.bin/electron main.js --remote-debugging-port=9223"
      cdp-endpoint: http://127.0.0.1:9223
      lt-username: ${{ secrets.LT_USERNAME }}
      lt-access-key: ${{ secrets.LT_ACCESS_KEY }}
      codex-api-key: ${{ secrets.CODEX_API_KEY }}
      vars: ${{ toJSON(vars) }}
```

### Platform support

Fake Kane tests check the build, install/upload arguments, process cleanup, cache and
fix ordering. They do not prove device automation, cloud uploads or runner setup.

| Target / host | Verified with real Kane runs |
|---|---|
| Web, GitHub-hosted Linux/macOS/Windows | Linux/macOS: verified; Windows: not yet verified |
| Desktop Electron, macOS runner | Not yet verified |
| Android local, Apple Silicon Mac / self-hosted runner | Not yet verified |
| Android/iOS cloud real devices, needs a TestMu plan with real devices | Not yet verified |
| iOS local simulator, Apple Silicon Mac | Not yet verified |
| Windows host | Not yet verified; web, cloud mobile and desktop paths have fake coverage; local mobile requires an Apple Silicon Mac |
