<div align="center">

<img src="https://raw.githubusercontent.com/t1dem/proofed/main/site/public/favicon.svg" width="56" alt="">

# Proofed

**Kane CLI opens the app from a pull request and checks that its user flows work.<br>When a flow breaks, an agent fixes the code. Only a fix that Kane has checked lands in the PR.**

<!-- video: put "[**▶ Video (3 min)**](URL) · " at the start of the next line -->
[**Recorded run (1 min)**](https://proofed.neptunescodm.workers.dev/try/9) · [Break it yourself (live, 8–14 min)](https://proofed.neptunescodm.workers.dev/try) · [Install](https://proofed.neptunescodm.workers.dev/install) · [For judges](#for-judges)

[![Test CLI](https://github.com/t1dem/proofed/actions/workflows/test.yml/badge.svg)](https://github.com/t1dem/proofed/actions/workflows/test.yml) [![npm](https://img.shields.io/npm/v/proofed-cli)](https://www.npmjs.com/package/proofed-cli)

</div>

| Web · [Excalidraw #11974](https://github.com/excalidraw/excalidraw/pull/11974) | Android · [AnkiDroid #20889](https://github.com/ankidroid/Anki-Android/pull/20889) | Electron · [MarkText #5276](https://github.com/marktext/marktext/pull/5276) |
|---|---|---|
| <img src="https://github.com/t1dem/excalidraw/raw/proofed-clips/pr-1/af2468d-44301665790/dismiss-menus.gif" width="290" alt="Kane clicks the canvas, the main menu stays open"> | <img src="https://github.com/t1dem/Anki-Android/raw/proofed-clips/pr-1/76f468b-44372076531/select-deck-in-browser-search.gif" width="290" alt="Kane picks All decks, the filter doesn't change"> | <img src="https://github.com/t1dem/marktext/raw/proofed-clips/pr-1/d3b59fb-44369043777/heading-fold-across-tabs.gif" width="290" alt="Kane switches tabs, the folded heading unfolds"> |
| The main menu stays open after a click on the canvas. Codex fixed it, [Kane confirmed](https://github.com/t1dem/excalidraw/pull/1). | A deck picked in search doesn't change the filter. Codex fixed it, [Kane confirmed](https://github.com/t1dem/Anki-Android/pull/1). | A folded heading unfolds after switching tabs. Codex fixed it, [Kane confirmed](https://github.com/t1dem/marktext/pull/1). |

<p align="center"><sub>Three of nine merged open-source pull requests that shipped a bug. <a href="#bugs-from-real-projects">All nine</a>.<br>Built with Codex, Claude Code and Factory Droid for the <a href="https://www.kaneclihack.sh/">KaneCLI Online Hackathon</a>, November 12–26, 2026. Kane CLI 0.10.4.</sub></p>

## For judges

| Criterion | Where to look | Time |
|---|---|---|
| **Bar 1: runs end to end** | [Recorded run](https://proofed.neptunescodm.workers.dev/try/9): a PR is opened, Kane catches the bug, Claude fixes it, Kane confirms. Or [run it yourself](https://proofed.neptunescodm.workers.dev/try), no account needed | 1 min · 8–14 min |
| **Bar 2: Kane caught something** | [Nine regressions](#bugs-from-real-projects) that maintainers merged: web, Android and Electron | 2 min |
| **Bar 3 and Closed loop: the agent and Kane talked to each other** | [demo-store #9](https://github.com/t1dem/proofed-demo-store/pull/9): Kane rejected Claude's first fix, the second one passed and landed in the PR | 1 min |
| **Ships** | GitHub App, Action, [`proofed-cli`](https://www.npmjs.com/package/proofed-cli) on npm, MCP server, Stop hook for Claude Code | |
| **Verified** | Kane caught 13 bugs out of 13 and confirmed 13 fixes: nine in open-source projects and four in the demo store. A Kane pass without a check, or a pass the page text contradicts, is marked "not checked". [Six Kane failures and what we do about them](#what-we-ran-into-with-kane-cli) | 2 min |
| **Craft** | Three steps to a PR with the setup and scenarios Kane has already passed: sign in, save the keys, install the GitHub App. `--dry-run` is free. A PR that touches no scenario costs 0 credits | |
| **Three roles of Kane** | Checks every PR. Works inside the agent's session through `proofed check`, MCP and the Stop hook. Checked this repository's own PRs: 52 runs | |

## Bugs from real projects

Nine merged pull requests from open-source projects. Each one shipped a bug that the maintainers fixed later. For each project we wrote one scenario for the broken user flow and replayed the PR in a copy of the repository with Proofed. In all nine cases Kane caught the bug, Codex GPT-6.2 Sol (medium) fixed it, and Kane checked the fix before it landed in the PR.

| PR | Where | What broke | Fix by the agent and the maintainers |
|---|---|---|---|
| [omni-tools #32](https://github.com/iib0011/omni-tools/pull/32) | Web | [1, 2 and 4 on separate lines add up to 0 instead of 7](https://github.com/t1dem/omni-tools/pull/1) | Agent: +1 −1. The maintainers rewrote the function ([#428](https://github.com/iib0011/omni-tools/pull/428), 567 days later) |
| [frontend-mini-challenges #264](https://github.com/sadanandpai/frontend-mini-challenges/pull/264) | Web | [A deleted task stays in the list](https://github.com/t1dem/frontend-mini-challenges/pull/1) | Agent: +3 −3. The maintainers also reworked the component ([#338](https://github.com/sadanandpai/frontend-mini-challenges/pull/338), 28 days later) |
| [Excalidraw #11974](https://github.com/excalidraw/excalidraw/pull/11974) | Web | [The main menu stays open after a click on the canvas](https://github.com/t1dem/excalidraw/pull/1) | The maintainers added a test ([#12053](https://github.com/excalidraw/excalidraw/pull/12053), 12 days later) |
| [OpenCalc #520](https://github.com/Darkempire78/OpenCalc/pull/520) | Android | [The decimal point in the first number of 2×0.5 is ignored](https://github.com/t1dem/OpenCalc/pull/1) | [#538](https://github.com/Darkempire78/OpenCalc/pull/538), 81 days later |
| [Quillpad #396](https://github.com/quillpad/quillpad/pull/396) | Android | [Back in a note sends the app to the background instead of the notes list](https://github.com/t1dem/quillpad/pull/1) | The same +2 lines ([#406](https://github.com/quillpad/quillpad/pull/406), 24 days later) |
| [AnkiDroid #20889](https://github.com/ankidroid/Anki-Android/pull/20889) | Android | [A deck picked in the card browser search doesn't change the filter](https://github.com/t1dem/Anki-Android/pull/1) | The maintainers added a test ([#23110](https://github.com/ankidroid/Anki-Android/pull/23110), 180 days later) |
| [Zettlr #6001](https://github.com/Zettlr/Zettlr/pull/6001) | Electron | [A blank line between paragraphs loses its ¶ mark](https://github.com/t1dem/Zettlr/pull/1) | [#6024](https://github.com/Zettlr/Zettlr/pull/6024), 7 days later |
| [Zettlr #6031](https://github.com/Zettlr/Zettlr/pull/6031) | Electron | [An empty Pandoc span turns off highlighting in the note](https://github.com/t1dem/zettlr-pandoc/pull/1) | [#6448](https://github.com/Zettlr/Zettlr/pull/6448), 211 days later |
| [MarkText #5276](https://github.com/marktext/marktext/pull/5276) | Electron | [A folded heading unfolds after switching tabs](https://github.com/t1dem/marktext/pull/1) | The maintainers added tests ([#6060](https://github.com/marktext/marktext/pull/6060), 24 days later) |

In eight of the nine cases the agent edited the same files as the maintainers. In MarkText it also changed `store/editor.ts`. In four cases the maintainers added a test along with the fix; the agent wrote no tests. The web replays ran on GitHub's Ubuntu runners, Android and Electron on our own Apple Silicon Mac (Android 14 in the emulator).

## Demo store

Four PRs in the [demo store](https://github.com/t1dem/proofed-demo-store), each hiding a bug in an ordinary-looking change. Kane caught all four bugs and confirmed all four of the agent's fixes.

| PR | What Kane found |
|---|---|
| [#5](https://github.com/t1dem/proofed-demo-store/pull/5) | The promo code `welcome10` in lowercase is rejected |
| [#9](https://github.com/t1dem/proofed-demo-store/pull/9) | The confirmation page charges €13.00 instead of €17.90 |
| [#11](https://github.com/t1dem/proofed-demo-store/pull/11) | The + button in the bag leaves the quantity at 1 |
| [#12](https://github.com/t1dem/proofed-demo-store/pull/12) | A €44.50 bag ships free, though free shipping starts at €50 |

## Install

1. Sign in at [proofed.neptunescodm.workers.dev](https://proofed.neptunescodm.workers.dev/app) and save your TestMu keys and a Claude token or OpenAI API key.
2. Install the [GitHub App](https://proofed.neptunescodm.workers.dev/install) on a repository. Proofed opens a PR with the workflow and saves the keys as encrypted GitHub Actions secrets (Settings → Secrets and variables → Actions).
3. In that PR the agent writes up to five scenarios for the app's main flows. Only the ones Kane passed are committed.

Locally and from an agent:

```sh
npx proofed-cli check                      # the scenarios the current change touches
npx proofed-cli check --dry-run            # what would run and how many credits, for free
```

For Claude Code, add this to the project's `.mcp.json`:

```json
{"mcpServers":{"proofed":{"command":"npx","args":["-y","proofed-cli","mcp"]}}}
```

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/t1dem/proofed/main/docs/flow-dark.svg">
  <img src="https://raw.githubusercontent.com/t1dem/proofed/main/docs/flow-light.svg" alt="Pull request, then Kane runs the scenarios it touches in Chrome, then a report with clips on the PR. If a scenario broke, Codex fixes it and Kane checks again, up to 3 attempts.">
</picture>

- A scenario is one Markdown file per user flow in `.proofed/scenarios/`, in plain English. Its `paths` field says which files it guards: such a scenario runs only when the diff touches those files. A scenario without `paths` runs on every PR.
- For web, Kane doesn't record video, so Proofed records Chrome itself: it cuts the waiting, shows where Kane clicked and zooms in on what it checks.
- A fix starts when someone ticks **Fix with Claude** or **Fix with Codex** in the comment, or on its own with [Fix automatically](docs/setup.md#fix-automatically) on.

## What we ran into with Kane CLI

What went wrong in real runs and what Proofed does about it.

| What happened | What Proofed does | Where |
|---|---|---|
| On a vague request Kane waited and returned "passed" | A pass without an `assert` step counts as "not checked" | `src/check/run.ts` |
| Kane went around a broken button and passed | Kane is told to do each step once, without workarounds | `src/check/run.ts` |
| A run was still going after 361 seconds | A 360-second limit on top of Kane's own `--timeout 300`; `timeout_minutes` in a scenario raises both | `src/kane/kane.ts` |
| Kane's child processes survived a normal kill and held the output | Kane runs in its own process group and is killed as a whole | `src/kane/kane.ts` |
| On a normal page Kane said the heading wasn't visible and blamed the scenario | Such a check runs again. Two failures stay a failure; a failure and a pass are "not checked" | `src/check/run.ts` |
| In 13 of 36 parallel runs a scenario finished within seconds | One `kane-cli login` before the scenarios, and one retry. The retry always reached a verdict | `action.yml`, `src/check/run.ts` |

## Limits

- **Kane's verdict on the same failure varies.** On [#6](https://github.com/t1dem/proofed-demo-store/pull/6) the same check that [#9](https://github.com/t1dem/proofed-demo-store/pull/9) shows as a break came back twice as "the test may be wrong". Without a failed check, Proofed marks such a run unconfirmed and doesn't start a fix.
- **A fix needs room in the provider's usage limit.** On [#7](https://github.com/t1dem/proofed-demo-store/pull/7) and [#8](https://github.com/t1dem/proofed-demo-store/pull/8) the limit ran out: Kane caught the bug, no fix followed, and the report says so.
- **Slower than unit tests.** One to four minutes of Kane per scenario, plus a build and a re-check per fix attempt.
- **Desktop is experimental:** one Electron window. Cloud iOS and Android devices aren't yet verified on a real plan.

## Documentation

- [Manual setup, Codex, Fix automatically](docs/setup.md)
- [CLI, MCP and the Stop hook](docs/cli.md)
- [Mobile and desktop apps](docs/cli.md#platform-support)
- [Text checks and uncertain passes](docs/setup.md#text-checks-and-uncertain-passes)
- [Credits](docs/cli.md#credits)
- [Code and releases](docs/release.md)

## License

[MIT](LICENSE)
