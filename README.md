# Proofed

Proofed runs the user flows a pull request touches in real Chrome with [Kane CLI](https://github.com/LambdaTest/kane-cli), records each run, and posts the clip on the PR. When a flow breaks, tick **Fix with Claude** in the comment: Claude Code gets the failure, Kane's steps and the diff, and Proofed pushes the fix only after Kane has watched it pass.

Built for the Kane CLI hackathon, November 2026.

## How a PR goes

1. You open a PR. Proofed diffs it against the base branch and picks the scenarios whose `paths` the diff touches.
2. Each start page is opened once in headless Chrome first. A page that throws while loading and stays blank fails its scenarios right away, with the browser's error, without spending Kane credits. Otherwise each scenario runs in its own headless Chrome. Kane drives the browser; Proofed records the screen over the Chrome DevTools Protocol, since Kane doesn't record video. The clip keeps a moment around each of Kane's clicks and keystrokes and cuts the waiting between them. A cursor shows where Kane clicked, the camera zooms in on the element it's using, and the clip ends on the part of the page the final check was about.
3. The PR gets one comment, edited on every run, with a GIF of each run, a link to the mp4, and Kane's explanation of what went wrong. The commit gets a `Proofed` status.
4. If Kane decides the test itself is wrong rather than the code, or reports a pass without checking anything on the page, the scenario is flagged as not checked: it doesn't block the merge, and it isn't counted as a pass. Browser hiccups (a screenshot timeout, a closed tab) are retried once and never reported as bugs.
5. Tick **Fix with Claude**, or comment `/proofed fix`. Claude Code edits the code, the app is rebuilt, and Kane re-runs the broken scenarios. Up to three attempts, each one told why the last failed. Nothing is pushed until a fix passes. The report and the commit (a `Fixed-by:` line) say which model made the fix. The report then shows each repaired scenario before and after: the failing run next to the passing one, and the files the fix changed.

## Commands

Comment on a PR. Only people with write access to the repo can run them.

| Comment | What happens |
|---|---|
| `/proofed` | Check the PR again. Works on PRs opened before Proofed was added; scenarios then come from the base branch. |
| `/proofed <what to check>` | Kane checks just that, e.g. `/proofed the kettle goes into the bag at €45.00`. |
| `/proofed fix` | Same as ticking the box: Claude fixes it with the repo's model. |
| `/proofed fix opus high` | This one fix with another model. `haiku`, `sonnet`, `opus` and `fable` mean the latest version; `opus 5.1` picks a version; a full ID like `claude-opus-5-1` is used as written. Effort (`low`, `medium`, `high`, `xhigh`, `max`) goes last and is optional. |

The repo's model is set in the [Proofed dashboard](https://proofed.neptunescodm.workers.dev/app) and saved as the `PROOFED_MODEL` and `PROOFED_EFFORT` Actions variables. Without them it's Haiku 5.5 at xhigh effort.

## Scenarios

A scenario is a Markdown file in `.proofed/scenarios/`: frontmatter, then the objective Kane runs, in plain English.

```md
---
name: Promo code total
paths: [src/pricing.ts, src/pages/Cart.tsx]
url: /
---
Add Ethiopia Guji to the bag twice and the Hand Grinder once.
Open the bag, type the promo code welcome10 in lowercase and apply it.
Check that the discount is −€9.10, shipping is Free and the total is €81.90.
```

A scenario without `paths` runs on every PR. Editing a scenario file also runs it.

## Setup

The easy way: sign in at [proofed.neptunescodm.workers.dev](https://proofed.neptunescodm.workers.dev/app), save your keys and install the GitHub App on a repo. Proofed opens a PR with the workflow and a first scenario, and puts the keys into the repo's secrets.

By hand: add `LT_USERNAME` and `LT_ACCESS_KEY` (TestMu: Settings → Keys) and `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) to the repo secrets, then add one workflow. The action checks out the PR, builds and serves the app with your commands, and checks or fixes depending on the event. The whole file, working, is [proofed-demo-store's](https://github.com/t1dem/proofed-demo-store/blob/main/.github/workflows/proofed.yml); the part that matters:

```yaml
on:
  pull_request:
  issue_comment:
    types: [created, edited]
permissions: { contents: write, pull-requests: write, issues: write, statuses: write }
jobs:
  proofed:
    if: # PR events, /proofed comments from people with write access, and a ticked box (see the demo store)
    runs-on: ubuntu-latest
    steps:
      - uses: t1dem/proofed@main
        with:
          url: http://localhost:4173
          install: npm ci
          build: npm run build
          serve: npm run preview
          lt-username: ${{ secrets.LT_USERNAME }}
          lt-access-key: ${{ secrets.LT_ACCESS_KEY }}
          claude-code-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          vars: ${{ toJSON(vars) }}
```

`vars` hands the action every Actions variable of the repo, so a new setting from the dashboard works without editing the workflow. Repos set up before this keep working: without `serve`, the action only runs the check against an app the workflow already serves, and `t1dem/proofed/fix@main` stays the fixer.

Clips are committed to a `proofed-clips` branch of the same repo, so the GIFs render inline in the comment without any storage of your own. This works in private repos too: anyone who can open the PR can see the clips.

## Cost

A scenario takes about a minute and 20–30 Kane credits. Proofed only runs the scenarios the diff touches, and a fix attempt re-runs only the ones that broke.

## Code

TypeScript that Node 24 runs directly, no build step. `src/mode.ts` decides what an event asks for, `src/cli.ts` is the PR check, `src/fix.ts` the fix loop, `src/run.ts` one scenario (Chrome, recorder, Kane, clip). `pnpm test` runs the unit tests.
