// When Proofed is installed on a repo, open a pull request that wires it up: the one workflow that
// checks and fixes, and a first scenario. Build commands are guessed from package.json, and the PR
// says what was guessed so a human can correct it before merging. The PR's own check then has
// Claude write scenarios for the app's main flows and adds the ones Kane saw pass (src/generate.ts).
import { FIRST_SCENARIO, SETUP_BRANCH } from "../../../src/setup";
import { gh, GitHubError } from "./github";

type Repo = { full_name: string; default_branch?: string };
export type Commands = { setup: string; cache: string; dir: string; install: string; build: string; serve: string; url: string; notes: string[] };

async function readFile(token: string, repo: string, path: string) {
  try {
    const file = await gh<{ content: string }>(token, "GET", `/repos/${repo}/contents/${path}`);
    return atob(file.content.replace(/\n/g, ""));
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return undefined;
    throw e;
  }
}

type Pkg = { scripts?: Record<string, string>; packageManager?: string };
const join = (dir: string, file: string) => (dir === "." ? file : `${dir}/${file}`);
const readPkg = async (token: string, repo: string, dir: string) => {
  const text = await readFile(token, repo, join(dir, "package.json"));
  return text ? (JSON.parse(text) as Pkg) : undefined;
};
// A package.json that can put an app on a port, as opposed to a library's or a monorepo root's.
const servable = (pkg: Pkg | undefined) => !!pkg?.scripts && ["preview", "start", "dev"].some((s) => s in pkg.scripts!);

// Where the app lives. The root when it has an app's scripts; otherwise the shallowest folder that
// does (site/, apps/web/…), since a root package.json is often only tooling around the app.
async function findApp(token: string, repo: string, ref: string): Promise<{ dir: string; pkg: Pkg | undefined; root: Pkg | undefined }> {
  const root = await readPkg(token, repo, ".");
  if (servable(root)) return { dir: ".", pkg: root, root };
  const { tree } = await gh<{ tree: { path: string; type: string }[] }>(token, "GET", `/repos/${repo}/git/trees/${ref}?recursive=1`);
  const depth = (path: string) => path.split("/").length;
  const dirs = tree
    .filter((f) => f.type === "blob" && f.path.endsWith("/package.json") && !f.path.includes("node_modules/") && depth(f.path) <= 4)
    .map((f) => f.path.slice(0, -"/package.json".length))
    .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))
    .slice(0, 8);
  for (const dir of dirs) {
    const pkg = await readPkg(token, repo, dir);
    if (servable(pkg)) return { dir, pkg, root };
  }
  return { dir: ".", pkg: root, root };
}

async function guessCommands(token: string, repo: string, ref: string): Promise<Commands> {
  const { dir, pkg, root } = await findApp(token, repo, ref);
  if (!pkg) {
    return {
      setup: "",
      cache: "",
      dir,
      install: "true",
      build: "true",
      serve: "npx --yes serve@14 -l 4173 .",
      url: "http://localhost:4173",
      notes: ["No package.json, so the repo is served as static files from its root."],
    };
  }

  const scripts = pkg.scripts ?? {};
  // A workspace keeps its lockfile at the root; a folder with its own project keeps it next to package.json.
  const lock = async (file: string) =>
    (await readFile(token, repo, join(dir, file))) !== undefined ? dir : dir !== "." && (await readFile(token, repo, file)) !== undefined ? "." : undefined;
  const [pnpm, yarn, npmLock] = await Promise.all(["pnpm-lock.yaml", "yarn.lock", "package-lock.json"].map(lock));
  const pm = pnpm ? "pnpm" : yarn ? "yarn" : "npm";
  const lockDir = pnpm ?? yarn ?? npmLock;
  const pinned = /^pnpm@([\d.]+)/.exec(pkg.packageManager ?? root?.packageManager ?? "")?.[1];
  const run = (script: string) => (pm === "npm" ? `npm run ${script}` : `${pm} ${script}`);
  const notes: string[] = [];
  if (dir !== ".") notes.push(`The app is in \`${dir}/\`: the root has no script that serves one. Commands run there.`);
  notes.push(`Package manager: ${pm}, from the lockfile.`);

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
    // pnpm is set up before the action checks the repo out, so it can't read packageManager itself.
    setup: pm === "pnpm" ? `      - uses: pnpm/action-setup@v4\n        with:\n          version: ${pinned ?? "10"}\n` : "",
    // setup-node only finds a lockfile at the repo root.
    cache: lockDir === "." ? pm : "",
    dir,
    install,
    build,
    serve,
    url,
    notes,
  };
}

// One workflow does everything; the action reads the event and either checks the PR or fixes it.
// `vars` hands it all of the repo's Actions variables, so settings added to the dashboard later
// reach the action without another PR to this file. `bot` is the app's login, the author of the fixer's pushes.
export const workflow = (c: Commands, bot: string) => `name: Proofed

# One workflow for everything Proofed does on a PR:
# - every push to a PR: Kane checks the affected scenarios in Chrome;
# - "/proofed" in a comment: check again; "/proofed <what to check>": check just that;
# - "/proofed fix [model] [effort]", or ticking "Fix with Claude" in the report: Claude fixes it.
on:
  pull_request:
  issue_comment:
    types: [created, edited]

permissions:
  contents: write # clips go to the proofed-clips branch, fixes to the PR's branch
  pull-requests: write
  issues: write
  statuses: write
  # Traded for a push token of the Proofed app, so the workflows on Claude's fix commit run without an approval.
  id-token: write

jobs:
  proofed:
    name: Proofed
    # Comments count only from people with write access: the run uses this repo's keys on the PR's code.
    # An edit counts only on Proofed's own report, which only people with write access can tick.
    if: >-
      github.event_name == 'pull_request' || (
        github.event.issue.pull_request && ((
          github.event.action == 'created' &&
          contains(github.event.comment.body, '/proofed') &&
          contains(fromJSON('["OWNER", "MEMBER", "COLLABORATOR"]'), github.event.comment.author_association)
        ) || (
          github.event.action == 'edited' &&
          github.event.comment.user.type == 'Bot' &&
          contains(github.event.comment.body, '<!-- proofed -->') &&
          contains(github.event.comment.body, '- [x] **Fix with Claude**')
        ))
      )
    runs-on: ubuntu-latest
    timeout-minutes: 40
    concurrency:
      group: proofed-\${{ github.event.pull_request.number || github.event.issue.number }}
      # A new push makes the running check stale; a comment waits for the run in progress. So does the run
      # on Claude's fix, pushed by the Proofed app: the fix run is still reporting on that commit.
      cancel-in-progress: \${{ github.event_name == 'pull_request' && github.actor != '${bot}' }}
    steps:
${c.setup}      - uses: t1dem/proofed@main
        with:
          url: ${c.url}
${c.dir === "." ? "" : `          working-directory: ${c.dir}\n`}          install: ${c.install}
          build: ${c.build}
          serve: ${c.serve}
${c.cache ? `          cache: ${c.cache}\n` : ""}          lt-username: \${{ secrets.LT_USERNAME }}
          lt-access-key: \${{ secrets.LT_ACCESS_KEY }}
          claude-code-oauth-token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          # Settings from the Proofed dashboard, such as the model Claude fixes with.
          vars: \${{ toJSON(vars) }}
`;
const prBody = (repo: string, c: Commands) => `Proofed runs the user flows a pull request touches in real Chrome with Kane CLI, records each run, and posts it on the PR. When a flow breaks, ticking **Fix with Claude** in that comment lets Claude Code fix it; the fix is pushed only after Kane has watched it pass.

This PR adds:

- \`.github/workflows/proofed.yml\`: one workflow. It checks every pull request in Chrome, checks again on a \`/proofed\` comment, and has Claude fix a failure when you tick **Fix with Claude** or comment \`/proofed fix\`. \`/proofed fix opus high\` picks another model for that one fix; the repo's model is set in the dashboard.
- \`.proofed/scenarios/home.md\`: a first scenario. Add one Markdown file per flow; \`paths\` limits a scenario to PRs that touch those files.

**Proofed will add scenarios to this PR itself.** On this PR's check, Claude reads the app and writes a few for its main flows, Kane runs each one in Chrome, and only the ones Kane saw pass are committed here; the comment below lists them. It needs \`CLAUDE_CODE_OAUTH_TOKEN\`, and happens only while \`home.md\` is the only scenario. They are plain Markdown: edit or delete them before you merge, like any other file.

**Keys.** The checks need three repository secrets: \`LT_USERNAME\`, \`LT_ACCESS_KEY\` (TestMu) and \`CLAUDE_CODE_OAUTH_TOKEN\` (from \`claude setup-token\`). If you saved them at https://proofed.neptunescodm.workers.dev/app, Proofed has already added them; otherwise add them under [Settings → Secrets → Actions](https://github.com/${repo}/settings/secrets/actions).

**Check what was guessed about your build:**

${c.notes.map((n) => `- ${n}`).join("\n")}
- Install: \`${c.install}\` · Build: \`${c.build}\` · Serve: \`${c.serve}\` at ${c.url}

Proofed checks this pull request with those commands too. If one of them is wrong, its comment below says which failed and what it printed.

Docs: https://github.com/t1dem/proofed
`;

export async function openSetupPr(token: string, repo: Repo, appSlug: string) {
  const name = repo.full_name;
  if ((await readFile(token, name, ".github/workflows/proofed.yml")) !== undefined) return { skipped: "already set up" };

  const base = repo.default_branch ?? (await gh<{ default_branch: string }>(token, "GET", `/repos/${name}`)).default_branch;
  const head = await gh<{ object: { sha: string } }>(token, "GET", `/repos/${name}/git/ref/heads/${base}`).catch((e: unknown) => {
    if (e instanceof GitHubError && e.status === 409) return undefined; // empty repo
    throw e;
  });
  if (!head) return { skipped: "empty repository" };

  const commands = await guessCommands(token, name, head.object.sha);
  const baseCommit = await gh<{ tree: { sha: string } }>(token, "GET", `/repos/${name}/git/commits/${head.object.sha}`);
  const tree = await gh<{ sha: string }>(token, "POST", `/repos/${name}/git/trees`, {
    base_tree: baseCommit.tree.sha,
    tree: [
      { path: ".github/workflows/proofed.yml", mode: "100644", type: "blob", content: workflow(commands, `${appSlug}[bot]`) },
      { path: ".proofed/scenarios/home.md", mode: "100644", type: "blob", content: FIRST_SCENARIO },
    ],
  });
  const commit = await gh<{ sha: string }>(token, "POST", `/repos/${name}/git/commits`, {
    message: "Add Proofed: browser checks with Kane CLI on every PR",
    tree: tree.sha,
    parents: [head.object.sha],
  });

  try {
    await gh(token, "POST", `/repos/${name}/git/refs`, { ref: `refs/heads/${SETUP_BRANCH}`, sha: commit.sha });
  } catch (e) {
    if (!(e instanceof GitHubError && e.status === 422)) throw e;
    await gh(token, "PATCH", `/repos/${name}/git/refs/heads/${SETUP_BRANCH}`, { sha: commit.sha, force: true });
  }

  const pr = await gh<{ html_url: string }>(token, "POST", `/repos/${name}/pulls`, {
    title: "Add Proofed",
    head: SETUP_BRANCH,
    base,
    body: prBody(name, commands),
  }).catch(async (e: unknown) => {
    // A setup PR from an earlier install is still open: it now points at the fresh commit.
    if (e instanceof GitHubError && e.status === 422) {
      const [open] = await gh<{ html_url: string }[]>(token, "GET", `/repos/${name}/pulls?head=${name.split("/")[0]}:${SETUP_BRANCH}&state=open`);
      if (open) return open;
    }
    throw e;
  });
  return { pr: pr.html_url };
}
