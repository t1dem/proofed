# Setup

Setting up Proofed on a repo, writing scenarios, PR commands, automatic fixes and text checks. The CLI, MCP server and Stop hook are in [cli.md](cli.md).

1. Sign in at [proofed.neptunescodm.workers.dev](https://proofed.neptunescodm.workers.dev/app) and save your TestMu keys and a Claude token or OpenAI API key.
2. Install the GitHub App on a repo. Proofed opens a PR with the workflow and saves the keys as encrypted GitHub Actions secrets (Settings → Secrets and variables → Actions).
3. On that PR, the selected provider writes up to five scenarios for the app's main flows. Only the ones Kane saw pass are committed.

One-click setup detects Gradle Android apps and configures checks on real cloud devices. This setup is not yet verified on a real device plan.

A web scenario takes 1 to 4 minutes and is estimated at 30 Kane credits the first time. Mobile and desktop costs are unknown without history. A fix attempt re-runs the broken scenarios and affected neighboring scenarios before pushing.

<details>
<summary><b>Setting it up by hand</b></summary>

<br>

Add `LT_USERNAME` and `LT_ACCESS_KEY` (TestMu: Settings → Keys) and either `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) or `CODEX_API_KEY` (an OpenAI API key) to the repo secrets. If you use Codex, choose a Codex model in Proofed's repository settings or set the repository Actions variable `PROOFED_PROVIDER` to `codex` before running the workflow.

Then add one workflow. The whole file, working, is [proofed-demo-store's](https://github.com/t1dem/proofed-demo-store/blob/main/.github/workflows/proofed.yml); the part that matters:

```yaml
on:
  pull_request:
  issue_comment:
    types: [created, edited]
permissions: { contents: write, pull-requests: write, issues: write, statuses: write, id-token: write }
jobs:
  proofed:
    if: # PR events, /proofed comments from people with write access, and a ticked box (see the demo store)
    runs-on: ubuntu-latest
    concurrency:
      group: proofed-${{ github.event.pull_request.number || github.event.issue.number }}
      # A new push cancels a stale check, but not the push of the fix: that run waits for the fix run.
      cancel-in-progress: ${{ github.event_name == 'pull_request' && github.actor != 'proofed-by-kane[bot]' }}
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
          codex-api-key: ${{ secrets.CODEX_API_KEY }}
          vars: ${{ toJSON(vars) }}
```

- `vars` hands the action every Actions variable of the repo, so a new setting from the dashboard works without editing the workflow.
- `id-token: write` lets Proofed's server push the fix commit as the Proofed GitHub App (the job itself gets no app token), so your other workflows run on the fix commit without waiting for approval. Without it the fix is pushed with `GITHUB_TOKEN`.
- Clips go to a `proofed-clips` branch of the same repo, so the GIFs render in the comment with no storage of your own, in private repos too.
- Claude aliases: `haiku`, `sonnet`, `opus`, `fable`. A version such as `opus 5.1` and full Claude IDs are accepted. Effort: `low`, `medium`, `high`, `xhigh`, `max`.
- Codex aliases: `sol`, `terra`, `astra`, `luna`. Full IDs: `gpt-6.2-sol`, `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-astra`, `gpt-6-luna`. Effort: `low`, `medium`, `high`, `xhigh`, `max`; Sol, Terra and Astra also accept `ultra`.
- Actions variables `PROOFED_PROVIDER`, `PROOFED_MODEL`, `PROOFED_EFFORT` and `PROOFED_AUTOFIX` store the menu choice. The provider can be inferred from the model. Existing Claude workflows and their checkbox label keep working. To enable Codex in an installed workflow, add `codex-api-key: ${{ secrets.CODEX_API_KEY }}` and let its edited-comment condition match `- [x] **Fix with Codex**` as well as `- [x] **Fix with Claude**`.
- Codex CLI is installed only for Codex runs. `codex exec` reads `CODEX_API_KEY`; local runs can also use `codex login`. Its workspace-write sandbox blocks command network access and writes outside the workspace, and Proofed restores changes to scenarios and workflows before checking a fix.
- The checkout keeps no token in `.git/config` (`persist-credentials: false`); the push hands the token to git itself. Claude and Codex start without the job's tokens. A change that still contains one is discarded before it is built or checked, and the agent's answer is masked before it reaches the PR or the dashboard.

</details>

## Scenarios

One Markdown file per flow in `.proofed/scenarios/`, in plain English. `paths` says which files it guards; without it, the scenario runs on every PR.

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

Put the exact text the page should show in quotes in the last check (`Check that the total is "€81.90".`): Proofed then compares it with the page itself ([Text checks](#text-checks-and-uncertain-passes)).

## Commands

Comment on a PR. Only people with write access can run them.

| Comment | What happens |
|---|---|
| `/proofed` | Check the PR again |
| `/proofed <what to check>` | Kane checks just that, e.g. `/proofed the kettle goes into the bag at €45.00` |
| `/proofed fix` | Fix with the repository's selected provider and model |
| `/proofed fix opus high` | This one fix with Claude Opus at high effort |
| `/proofed fix sol high` | This one fix with Codex GPT-6.2 Sol at high effort |
| `/proofed fix codex` | This one fix with Codex GPT-6.2 Sol |

The repo's provider, model and effort are set in the [dashboard](https://proofed.neptunescodm.workers.dev/app), under Settings in the repo's model menu. The two icons switch between Claude and Codex. Without a choice, fixes use Claude Haiku 5.5 at xhigh effort. The same choice writes scenarios on the setup PR.

## Fix automatically

By default a fix waits for someone to tick **Fix with Claude** or **Fix with Codex**. With **Fix automatically** on, it starts as soon as Kane sees a scenario fail. It doesn't start:

- on draft pull requests,
- on pushes by bots, so the fixer's own commit doesn't start another fix,
- on a run Kane marked "not checked".

In the [dashboard](https://proofed.neptunescodm.workers.dev/app), open Settings, click the model menu in the repo's row (it reads like "Haiku 5.5 · xhigh") and turn on **Fix automatically** at the bottom. Or with the GitHub CLI:

```sh
gh variable set PROOFED_AUTOFIX --body true --repo owner/repo   # on
gh variable delete PROOFED_AUTOFIX --repo owner/repo            # off
```

## Text checks and uncertain passes

For web runs, Proofed compares Kane's pass on the scenario's last check with the page text. It costs no Kane credits.

- **What is compared.** Text in quotes anywhere in the last check, such as `Check that the total is "€81.90".` Without quotes, only the shape `Check that A contains B.` (or `shows`, `lists`, `includes`), and only for a side of two or more words that reads like on-screen text: `Check that Vos outils favoris contains Générateur de token.` compares both names, `Check that the favorites section contains Token generator.` compares only `Token generator`.
- **When.** Proofed reads the page as Kane starts the assert for that check and again as it finishes it. A text counts as missing only when both reads lack it.
- **What is read.** All visible text in the document, not just the part in view: open shadow roots, same-origin frames, input values and placeholders, the chosen option of a select, image `alt`, `aria-label` and `title`, SVG text and CSS `content`. Case, spaces and quote or dash styles don't matter.
- **What a contradiction does.** A missing text turns Kane's pass into "not checked", and the reason names the text. Nothing is ever turned into a failure.
- **What is left to Kane.** Negative checks ("no longer", "not"), other wordings, colours, layout, and whether the text is in the right place. A page with a visible canvas, video, embedded object, cross-origin frame, registered custom element without an open shadow root, or CSS counter can't contradict Kane, since its text may not be readable. Images and icons don't stop the comparison, so a check whose text exists only as pixels in an image can end up "not checked".

If a failed assert is retried because Kane doubts the scenario, two failures stay failed. A failure followed by a pass is "not checked", and both runs' reasons are kept.
