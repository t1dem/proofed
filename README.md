# Proofed

Proofed runs the user flows a pull request touches in real Chrome with [Kane CLI](https://github.com/LambdaTest/kane-cli), records each run, and posts the clip on the PR. When a flow breaks, tick **Fix with Claude** in the comment: Claude Code gets the failure, Kane's steps and the diff, and Proofed pushes the fix only after Kane has watched it pass.

Built for the Kane CLI hackathon, November 2026.

## How a PR goes

1. You open a PR. Proofed diffs it against the base branch and picks the scenarios whose `paths` the diff touches.
2. Each scenario runs in its own headless Chrome. Kane drives the browser; Proofed records the screen over the Chrome DevTools Protocol, since Kane doesn't record video.
3. The PR gets one comment, edited on every run, with a GIF of each run, a link to the mp4, and Kane's explanation of what went wrong. The commit gets a `Proofed` status.
4. If Kane decides the test itself is wrong rather than the code, the scenario is flagged and doesn't block the merge. Browser hiccups (a screenshot timeout, a closed tab) are retried once and never reported as bugs.
5. Tick **Fix with Claude**. Claude Code (Haiku 5.5 at xhigh effort by default, set by the `model` and `effort` inputs) edits the code, the app is rebuilt, and Kane re-runs the broken scenarios. Up to three attempts, each one told why the last failed. Nothing is pushed until a fix passes.

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

Add `LT_USERNAME` and `LT_ACCESS_KEY` (TestMu: Settings → Keys) to the repo secrets, and `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) for the fixer. Then start your app and call the action:

```yaml
on: pull_request
permissions: { contents: write, pull-requests: write, issues: write, statuses: write }
jobs:
  kane:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { ref: "${{ github.event.pull_request.head.sha }}", fetch-depth: 0 }
      - run: npm ci && npm run build && (npm run preview &) && npx wait-on http://localhost:4173
      - uses: t1dem/proofed@main
        with:
          url: http://localhost:4173
          lt-username: ${{ secrets.LT_USERNAME }}
          lt-access-key: ${{ secrets.LT_ACCESS_KEY }}
```

The fixer is a second workflow on `issue_comment: edited` that calls `t1dem/proofed/fix@main` with your install, build and serve commands. Both workflows, working, are in [proofed-demo-store](https://github.com/t1dem/proofed-demo-store/tree/main/.github/workflows).

Clips are committed to a `proofed-clips` branch of the same repo, so the GIFs render inline in the comment without any storage of your own.

## Cost

A scenario takes about a minute and 20–30 Kane credits. Proofed only runs the scenarios the diff touches, and a fix attempt re-runs only the ones that broke.

## Code

TypeScript that Node 24 runs directly, no build step. `src/cli.ts` is the PR check, `src/fix.ts` the fix loop, `src/run.ts` one scenario (Chrome, recorder, Kane, clip). `pnpm test` runs the unit tests.
