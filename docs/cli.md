# proofed check

The reference for `proofed check`. Installing it and the three commands are in the [README](../README.md#locally-and-from-an-ai-agent).

## What it checks

The change is everything since the merge base with the default branch (`origin/HEAD`, else `origin/main`, or `--base`), uncommitted and untracked files included.

## Where it finds the app

The URL and the commands that install, build and serve the app are taken from the first of these that sets them:

1. `--url`, `--install`, `--build`, `--serve`
2. `PROOFED_URL`, `PROOFED_INSTALL`, `PROOFED_BUILD`, `PROOFED_SERVE`
3. `.proofed/config.json`
4. the Proofed step of the repo's workflow, so a repo that already runs Proofed on its PRs needs no flags

Before anything is built, `kane-cli balance` (free) checks that TestMu accepts the login or the `LT_USERNAME` and `LT_ACCESS_KEY`. If it doesn't, the check stops with exit 3: `kane_not_signed_in` (fix: `kane-cli login`) or `kane_keys_rejected` (the keys are wrong or expired).

If the app isn't running, Proofed starts it and stops it at the end. It installs the dependencies only when `node_modules` is missing or older than `package.json` or the lockfile (with the install command found as above, else the app's package manager), then builds, then serves. If something already answers at the URL and a build is configured, the check stops rather than test what may be an old build; `--reuse` tests it anyway.

## Caching and output

A passed scenario isn't run again until its file, the URL, the base commit or a changed file in its `paths` changes. `--dry-run` shows what would run and the credit estimate, for free. In a terminal the scenarios update in place; in a pipe each event is one line, with a "still running" line at least every 30 seconds.

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

A first run is estimated at 30 Kane credits per scenario. Later estimates use the last reported cost. Credits are what Kane reported for the runs; the account balance can drop slightly more. An interrupted run can spend credits before Kane reports them.

## JSON and exit codes

`--json` prints one JSON document on stdout and the progress on stderr. Every run also writes it to `.proofed-out/result.json`, next to the clips; the folder has its own `.gitignore`.

| Exit | Meaning |
|---|---|
| 0 | Everything checked passed |
| 1 | A scenario failed |
| 2 | Nothing failed, but something wasn't checked |
| 3 | The check couldn't start. The message says why and how to fix it; running it again unchanged won't help |
| 130 | Ctrl-C or a closed terminal. Kane, Chrome and the app are stopped first |

`failedCheck: "scenario_doubted"` means a scenario's check failed, but Kane believes the scenario is out of date. `diagnosis` is Kane's opinion; `suggestion` and `next` say to update the scenario if the app change was intended, otherwise fix the app. Such a failure is run a second time, at the scenario's cost again, and the second run is the result: Kane gives the same verdict when it misreads a page that is fine, and a misreading rarely repeats. A check that fails both times is a failure (exit 1). `notChecked: "scenario_doubted"` means Kane doubted the scenario without a failed check (exit 2).
