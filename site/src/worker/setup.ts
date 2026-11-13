// When Proofed is installed on a repo, open a pull request that wires it up: the check workflow,
// the fix workflow and a first scenario. Build commands are guessed from package.json, and the PR
// says what was guessed so a human can correct it before merging.
import { gh, GitHubError } from "./github";

type Repo = { full_name: string; default_branch?: string };
type Commands = { setup: string; fixSetup: string; cache: string; install: string; build: string; serve: string; url: string; notes: string[] };

const BRANCH = "proofed-setup";

async function readFile(token: string, repo: string, path: string) {
  try {
    const file = await gh<{ content: string }>(token, "GET", `/repos/${repo}/contents/${path}`);
    return atob(file.content.replace(/\n/g, ""));
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return undefined;
    throw e;
  }
}

async function guessCommands(token: string, repo: string): Promise<Commands> {
  const pkgText = await readFile(token, repo, "package.json");
  if (!pkgText) {
    return {
      setup: "",
      fixSetup: "",
      cache: "",
      install: "true",
      build: "true",
      serve: "npx --yes serve@14 -l 4173 .",
      url: "http://localhost:4173",
      notes: ["No package.json, so the repo is served as static files from its root."],
    };
  }

  const pkg = JSON.parse(pkgText) as { scripts?: Record<string, string>; packageManager?: string };
  const scripts = pkg.scripts ?? {};
  // pnpm/action-setup fails if a version is given while package.json also pins one.
  const pinned = /^pnpm@([\d.]+)/.exec(pkg.packageManager ?? "")?.[1];
  const [pnpm, yarn, npmLock] = await Promise.all(
    ["pnpm-lock.yaml", "yarn.lock", "package-lock.json"].map((f) => readFile(token, repo, f).then(Boolean)),
  );
  const pm = pnpm ? "pnpm" : yarn ? "yarn" : "npm";
  const run = (script: string) => (pm === "npm" ? `npm run ${script}` : `${pm} ${script}`);
  const notes: string[] = [`Package manager: ${pm}, from the lockfile.`];

  const install = pm === "pnpm" ? "pnpm install --frozen-lockfile" : pm === "yarn" ? "yarn install --frozen-lockfile" : npmLock ? "npm ci" : "npm install";
  const build = scripts.build ? run("build") : "true";
  if (!scripts.build) notes.push("No `build` script, so nothing is built.");

  let serve: string;
  let url: string;
  if (scripts.preview) {
    serve = `${run("preview")} --port 4173`;
    url = "http://localhost:4173";
    notes.push("The app is served with the `preview` script on port 4173.");
  } else if (scripts.start) {
    serve = run("start");
    url = "http://localhost:3000";
    notes.push("The app is served with the `start` script; port 3000 is a guess.");
  } else {
    serve = "npx --yes serve@14 -l 4173 dist";
    url = "http://localhost:4173";
    notes.push("No `preview` or `start` script, so `dist/` is served as static files.");
  }

  return {
    setup: pm !== "pnpm" ? "" : pinned ? "      - uses: pnpm/action-setup@v4\n" : "      - uses: pnpm/action-setup@v4\n        with:\n          version: 10\n",
    // The fix job sets pnpm up before the checkout, so it always needs the version spelled out.
    fixSetup: pm === "pnpm" ? `      - uses: pnpm/action-setup@v4\n        with:\n          version: ${pinned ?? "10"}\n` : "",
    cache: pm === "npm" ? "npm" : pm,
    install,
    build,
    serve,
    url,
    notes,
  };
}

const checkWorkflow = (c: Commands) => `name: Proofed

on:
  pull_request:
  # "/proofed" in a PR comment checks that PR again (also one opened before Proofed was added);
  # "/proofed <what to check>" has Kane check just that.
  issue_comment:
    types: [created]

permissions:
  contents: write # clips go to the proofed-clips branch
  pull-requests: write
  issues: write
  statuses: write

jobs:
  kane:
    name: Kane in Chrome
    # Comments count only from people with write access: the run uses this repo's keys on the PR's code.
    if: >-
      github.event_name == 'pull_request' || (
        github.event.issue.pull_request &&
        contains(github.event.comment.body, '/proofed') &&
        contains(fromJSON('["OWNER", "MEMBER", "COLLABORATOR"]'), github.event.comment.author_association)
      )
    runs-on: ubuntu-latest
    timeout-minutes: 20
    concurrency:
      group: proofed-\${{ github.event.pull_request.number || github.event.issue.number }}
      cancel-in-progress: true
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha || format('refs/pull/{0}/head', github.event.issue.number) }}
          fetch-depth: 0
${c.setup}      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: ${c.cache}

      - name: Build and serve the app
        run: |
          ${c.install}
          ${c.build}
          (${c.serve} > serve.log 2>&1 &)
          npx --yes wait-on@8 -t 60000 ${c.url}

      - uses: t1dem/proofed@main
        with:
          url: ${c.url}
          lt-username: \${{ secrets.LT_USERNAME }}
          lt-access-key: \${{ secrets.LT_ACCESS_KEY }}
`;

const fixWorkflow = (c: Commands) => `name: Proofed fix

on:
  issue_comment:
    types: [edited]

permissions:
  contents: write
  pull-requests: write
  issues: write
  statuses: write

jobs:
  fix:
    name: Claude fixes, Kane checks
    # Only when the "Fix with Claude" box in Proofed's own comment gets ticked.
    if: >-
      github.event.issue.pull_request &&
      contains(github.event.comment.body, '<!-- proofed -->') &&
      contains(github.event.comment.body, '- [x] **Fix with Claude**')
    runs-on: ubuntu-latest
    timeout-minutes: 30
    concurrency:
      group: proofed-fix-\${{ github.event.issue.number }}
    steps:
${c.fixSetup}      - uses: t1dem/proofed/fix@main
        with:
          url: ${c.url}
          install: ${c.install}
          build: ${c.build}
          serve: ${c.serve}
          lt-username: \${{ secrets.LT_USERNAME }}
          lt-access-key: \${{ secrets.LT_ACCESS_KEY }}
          claude-code-oauth-token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          # Set per repo from the Proofed dashboard; empty means Haiku 5.5 at xhigh.
          model: \${{ vars.PROOFED_MODEL }}
          effort: \${{ vars.PROOFED_EFFORT }}
`;

const firstScenario = `---
name: Home page loads
url: /
---
Open the home page. Check that the main heading is visible and that the page shows no error message.
`;

const prBody = (repo: string, c: Commands) => `Proofed runs the user flows a pull request touches in real Chrome with Kane CLI, records each run, and posts it on the PR. When a flow breaks, ticking **Fix with Claude** in that comment lets Claude Code fix it; the fix is pushed only after Kane has watched it pass.

This PR adds:

- \`.github/workflows/proofed.yml\`: the check, on every pull request and on a \`/proofed\` comment
- \`.github/workflows/proofed-fix.yml\`: the fixer, when the box is ticked
- \`.proofed/scenarios/home.md\`: a first scenario. Add one Markdown file per flow; \`paths\` limits a scenario to PRs that touch those files.

**Keys.** The checks need three repository secrets: \`LT_USERNAME\`, \`LT_ACCESS_KEY\` (TestMu) and \`CLAUDE_CODE_OAUTH_TOKEN\` (from \`claude setup-token\`). If you saved them at https://proofed.neptunescodm.workers.dev/app, Proofed has already added them; otherwise add them under [Settings → Secrets → Actions](https://github.com/${repo}/settings/secrets/actions).

**Check what was guessed about your build:**

${c.notes.map((n) => `- ${n}`).join("\n")}
- Install: \`${c.install}\` · Build: \`${c.build}\` · Serve: \`${c.serve}\` at ${c.url}

Docs: https://github.com/t1dem/proofed
`;

export async function openSetupPr(token: string, repo: Repo) {
  const name = repo.full_name;
  if ((await readFile(token, name, ".github/workflows/proofed.yml")) !== undefined) return { skipped: "already set up" };

  const base = repo.default_branch ?? (await gh<{ default_branch: string }>(token, "GET", `/repos/${name}`)).default_branch;
  const head = await gh<{ object: { sha: string } }>(token, "GET", `/repos/${name}/git/ref/heads/${base}`).catch((e: unknown) => {
    if (e instanceof GitHubError && e.status === 409) return undefined; // empty repo
    throw e;
  });
  if (!head) return { skipped: "empty repository" };

  const commands = await guessCommands(token, name);
  const baseCommit = await gh<{ tree: { sha: string } }>(token, "GET", `/repos/${name}/git/commits/${head.object.sha}`);
  const tree = await gh<{ sha: string }>(token, "POST", `/repos/${name}/git/trees`, {
    base_tree: baseCommit.tree.sha,
    tree: [
      { path: ".github/workflows/proofed.yml", mode: "100644", type: "blob", content: checkWorkflow(commands) },
      { path: ".github/workflows/proofed-fix.yml", mode: "100644", type: "blob", content: fixWorkflow(commands) },
      { path: ".proofed/scenarios/home.md", mode: "100644", type: "blob", content: firstScenario },
    ],
  });
  const commit = await gh<{ sha: string }>(token, "POST", `/repos/${name}/git/commits`, {
    message: "Add Proofed: browser checks with Kane CLI on every PR",
    tree: tree.sha,
    parents: [head.object.sha],
  });

  try {
    await gh(token, "POST", `/repos/${name}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: commit.sha });
  } catch (e) {
    if (!(e instanceof GitHubError && e.status === 422)) throw e;
    await gh(token, "PATCH", `/repos/${name}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: true });
  }

  const pr = await gh<{ html_url: string }>(token, "POST", `/repos/${name}/pulls`, {
    title: "Add Proofed",
    head: BRANCH,
    base,
    body: prBody(name, commands),
  }).catch(async (e: unknown) => {
    // A setup PR from an earlier install is still open: it now points at the fresh commit.
    if (e instanceof GitHubError && e.status === 422) {
      const [open] = await gh<{ html_url: string }[]>(token, "GET", `/repos/${name}/pulls?head=${name.split("/")[0]}:${BRANCH}&state=open`);
      if (open) return open;
    }
    throw e;
  });
  return { pr: pr.html_url };
}
