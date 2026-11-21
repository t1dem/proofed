// When Proofed is installed on a repo, open a pull request that wires it up: the one workflow that
// checks and fixes, and a first scenario. Build commands are guessed from package.json or Gradle, and the PR
// says what was guessed so a human can correct it before merging. The PR's own check then has
// the selected agent write scenarios for the app's main flows and adds the ones Kane saw pass (src/fix/generate.ts).
import { FIRST_ANDROID_SCENARIO, FIRST_SCENARIO, SETUP_BRANCH } from "../../../src/action/setup";
import { gh, GitHubError } from "./github";

type Repo = { full_name: string; default_branch?: string };
export type Commands = { setup: string; cache: string; dir: string; install: string; build: string; serve: string; url: string; notes: string[] };
type AndroidCommands = { target: "android"; java: number; module: string; build: string; app: string };

async function readFile(token: string, repo: string, path: string, ref?: string) {
  try {
    const file = await gh<{ content: string }>(token, "GET", `/repos/${repo}/contents/${path}${ref ? `?ref=${ref}` : ""}`);
    return atob(file.content.replace(/\n/g, ""));
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return undefined;
    throw e;
  }
}

type Pkg = { scripts?: Record<string, string>; packageManager?: string; workspaces?: string[] | { packages?: string[] } };
// A folder name as a YAML value: plain only when YAML can't misread it, otherwise double-quoted (JSON
// is valid YAML). Plain means starting with a letter or "_" (so not "-", ".", or a number) and not a
// word YAML reads as a boolean or null.
const YAML_WORDS = /^(?:true|false|yes|no|on|off|y|n|null)$/i;
const yamlValue = (value: string) => (/^[A-Za-z_][\w./-]*$/.test(value) && !YAML_WORDS.test(value) ? value : JSON.stringify(value));
const join = (dir: string, file: string) => (dir === "." ? file : `${dir}/${file}`);
const readPkg = async (token: string, repo: string, dir: string) => {
  const text = await readFile(token, repo, join(dir, "package.json"));
  return text ? (JSON.parse(text) as Pkg) : undefined;
};
// A package.json that can put an app on a port, as opposed to a library's or a monorepo root's.
const servable = (pkg: Pkg | undefined) => !!pkg?.scripts && ["preview", "start", "dev"].some((s) => s in pkg.scripts!);

async function inWorkspace(dir: string, workspaces: Pkg["workspaces"]) {
  const patterns = Array.isArray(workspaces) ? workspaces : workspaces?.packages;
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  const { default: picomatch } = await import("picomatch/posix.js");
  let included = false;
  for (const glob of patterns) {
    if (typeof glob !== "string") continue;
    const bangs = glob.match(/^!+/)?.[0].length ?? 0;
    const pattern = glob.slice(bangs).replace(/^(?:\.?\/)+|\/+$/g, "");
    if (pattern && picomatch.isMatch(dir, pattern, { nonegate: true })) included = bangs % 2 === 0;
  }
  return included;
}

// Where the app lives. The root when it has an app's scripts; otherwise the shallowest folder that
// does (site/, apps/web/…), since a root package.json is often only tooling around the app.
async function findApp(token: string, repo: string, ref: string) {
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
  const files = tree.filter((f) => f.type === "blob").map((f) => f.path);
  return { dir: ".", pkg: root, root, android: await guessAndroid(token, repo, ref, files) };
}

const ANDROID_DEVICE = "Pixel 8";
const ANDROID_OS = "14";

async function guessAndroid(token: string, repo: string, ref: string, files: string[]): Promise<AndroidCommands | undefined> {
  if (!files.some((file) => /^settings\.gradle(?:\.kts)?$/.test(file))) return;

  // Gradle paths become shell arguments. Bound the file reads and try the conventional app module first.
  const candidates = files
    .filter((file) => /^(?:[\w-]+\/){1,3}build\.gradle(?:\.kts)?$/.test(file))
    .sort((a, b) => Number(!a.startsWith("app/")) - Number(!b.startsWith("app/")) || a.split("/").length - b.split("/").length || a.localeCompare(b))
    .slice(0, 8);
  const readGradle = async (file: string) => (await readFile(token, repo, file, ref) ?? "").replace(
    /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
    (part) => part.startsWith("/") ? " " : part,
  );
  const catalog = files.includes("gradle/libs.versions.toml") ? await readFile(token, repo, "gradle/libs.versions.toml", ref) : "";
  const aliases = [...(catalog ?? "").matchAll(/^([\w.-]+)\s*=\s*\{[^\r\n]*\bid\s*=\s*["']com\.android\.application["']/gm)]
    .map(([, alias]) => alias!.replace(/[-_]/g, "."));
  for (const file of candidates) {
    const gradle = await readGradle(file);
    const applies = gradle.split("\n").some((line) => !/\bapply\s*\(?\s*false\b/.test(line) && (
      /\b(?:id\s*\(?\s*|apply\s+plugin:\s*|apply\s*\(\s*plugin\s*=\s*)["']com\.android\.application["']/.test(line) ||
      [...line.matchAll(/\balias\s*\(\s*libs\.plugins\.([\w.]+)\s*\)/g)].some(([, alias]) => aliases.includes(alias!))
    ));
    if (!applies) continue;

    const rootBuild = files.find((path) => /^build\.gradle(?:\.kts)?$/.test(path));
    const scripts = gradle + (rootBuild ? "\n" + await readGradle(rootBuild) : "");
    const version = /\b(?:JavaLanguageVersion\.of|jvmToolchain)\s*\(\s*(\d{1,2})\s*\)/.exec(scripts)?.[1]
      ?? /\b(?:sourceCompatibility|targetCompatibility)\s*=\s*JavaVersion\.VERSION_(\d{1,2})\b/.exec(scripts)?.[1];
    // An older source level is common and doesn't imply that Gradle itself can run on that JDK.
    const java = Math.max(17, Number(version ?? 17));
    const dir = file.slice(0, file.lastIndexOf("/"));
    const module = `:${dir.replaceAll("/", ":")}`;
    return {
      target: "android",
      java,
      module,
      build: `./gradlew ${module}:assembleDebug`,
      app: `${dir}/build/outputs/apk/debug/${dir.split("/").at(-1)}-debug.apk`,
    };
  }
}

async function guessCommands(token: string, repo: string, ref: string): Promise<Commands | AndroidCommands> {
  const { dir, pkg, root, android } = await findApp(token, repo, ref);
  if (android) return android;
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
  const lock = async (file: string) => {
    if ((await readFile(token, repo, join(dir, file))) !== undefined) return dir;
    if (dir === "." || (file === "package-lock.json" && !(await inWorkspace(dir, root?.workspaces)))) return;
    if ((await readFile(token, repo, file)) !== undefined) return ".";
  };
  const [pnpm, yarn, npmLock] = await Promise.all(["pnpm-lock.yaml", "yarn.lock", "package-lock.json"].map(lock));
  const pm = pnpm ? "pnpm" : yarn ? "yarn" : "npm";
  const lockDir = pnpm ?? yarn ?? npmLock;
  const pinned = /^pnpm@([\d.]+)/.exec(pkg.packageManager ?? root?.packageManager ?? "")?.[1];
  const run = (script: string) => (pm === "npm" ? `npm run ${script}` : `${pm} ${script}`);
  const notes: string[] = [];
  if (dir !== ".") notes.push(`The app is in \`${dir}/\`: the root has no script that serves one. Commands run there.`);
  notes.push(lockDir ? `Package manager: ${pm}, from the lockfile.` : "Package manager: npm. No lockfile found for this app.");

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
export const workflow = (c: Commands | AndroidCommands, bot: string) => {
  const android = "target" in c;
  const setup = android ? `      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '${c.java}'
      - uses: android-actions/setup-android@v3
` : c.setup;
  const inputs = android ? `          target: android
          execution: cloud
          build: ${c.build}
          app: ${c.app}
          device: ${ANDROID_DEVICE}
          os-version: '${ANDROID_OS}'
` : `          url: ${c.url}
${c.dir === "." ? "" : `          working-directory: ${yamlValue(c.dir)}\n`}          install: ${c.install}
          build: ${c.build}
          serve: ${c.serve}
${c.cache ? `          cache: ${c.cache}\n` : ""}`;
  return `name: Proofed

# One workflow for everything Proofed does on a PR:
# - every push to a PR: Kane checks the affected scenarios ${android ? "on an Android cloud device" : "in Chrome"};
# - "/proofed" in a comment: check again; "/proofed <what to check>": check just that;
# - "/proofed fix [model] [effort]", or ticking the fix checkbox in the report: the selected provider fixes it.
on:
  pull_request:
  issue_comment:
    types: [created, edited]

permissions:
  contents: write # clips go to the proofed-clips branch, fixes to the PR's branch
  pull-requests: write
  issues: write
  statuses: write
  # Traded for a push token of the Proofed app, so the workflows on the fix commit run without an approval.
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
          (contains(github.event.comment.body, '- [x] **Fix with Claude**') || contains(github.event.comment.body, '- [x] **Fix with Codex**'))
        ))
      )
    runs-on: ubuntu-latest
    timeout-minutes: 40
    concurrency:
      group: proofed-\${{ github.event.pull_request.number || github.event.issue.number }}
      # A new push makes the running check stale; a comment waits for the run in progress. So does the run
      # on the fix, pushed by the Proofed app: the fix run is still reporting on that commit.
      cancel-in-progress: \${{ github.event_name == 'pull_request' && github.actor != '${bot}' }}
    steps:
${setup}      - uses: t1dem/proofed@main
        with:
${inputs}          lt-username: \${{ secrets.LT_USERNAME }}
          lt-access-key: \${{ secrets.LT_ACCESS_KEY }}
          claude-code-oauth-token: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          codex-api-key: \${{ secrets.CODEX_API_KEY }}
          # Settings from the Proofed dashboard, such as the fixer provider and model.
          vars: \${{ toJSON(vars) }}
`;
};

const prBody = (repo: string, c: Commands | AndroidCommands) => {
  const android = "target" in c;
  const where = android ? "on an Android cloud device" : "in Chrome";
  const intro = android
    ? "Proofed runs the user flows a pull request touches on a real Android device with Kane CLI and posts the results on the PR."
    : "Proofed runs the user flows a pull request touches in real Chrome with Kane CLI, records each run, and posts it on the PR.";
  const guesses = android ? `- Android application module \`${c.module}\` with Temurin Java ${c.java}.
- Build command is \`${c.build}\`.
- APK uses the conventional debug output path \`${c.app}\`. Update \`build\` and \`app\` if your project uses a flavor or a different APK name.
- Cloud device is ${ANDROID_DEVICE} on Android ${ANDROID_OS}.

Android cloud setup requires a TestMu plan with real devices. End-to-end setup is not yet verified on a real device plan.` : `${c.notes.map((n) => `- ${n}`).join("\n")}
- Install: \`${c.install}\` · Build: \`${c.build}\` · Serve: \`${c.serve}\` at ${c.url}`;
  return `${intro} When a flow breaks, ticking **Fix with Claude** or **Fix with Codex** in that comment lets the selected provider fix it; the fix is pushed only after Kane has watched it pass.

This PR adds:

- \`.github/workflows/proofed.yml\`: one workflow. It checks every pull request ${where}, checks again on a \`/proofed\` comment, and has the selected provider fix a failure when you tick the fix checkbox or comment \`/proofed fix\`. \`/proofed fix opus high\` picks another model for that one fix; the repo's model is set in the dashboard.
- \`.proofed/scenarios/home.md\`: a first scenario. Add one Markdown file per flow; \`paths\` limits a scenario to PRs that touch those files.

**Proofed will add scenarios to this PR itself.** On this PR's check, the selected provider reads the app and writes a few for its main flows, Kane runs each one ${where}, and only the ones Kane saw pass are committed here; the comment below lists them. It needs \`CLAUDE_CODE_OAUTH_TOKEN\` or \`CODEX_API_KEY\`, and happens only while \`home.md\` is the only scenario. They are plain Markdown: edit or delete them before you merge, like any other file.

**Keys.** The checks need \`LT_USERNAME\`, \`LT_ACCESS_KEY\` (TestMu), and either \`CLAUDE_CODE_OAUTH_TOKEN\` (from \`claude setup-token\`) or \`CODEX_API_KEY\` (from OpenAI). Manual setup opens this PR without copying keys. Automatic setup can open it even if copying fails.

To use Codex, choose a Codex model in Proofed's repository settings or set the Actions variable \`PROOFED_PROVIDER\` to \`codex\`. To copy saved keys, click **Add keys to repo** in [Proofed settings](https://proofed.neptunescodm.workers.dev/app/settings). You can also add keys directly in [GitHub → Settings → Secrets → Actions](https://github.com/${repo}/settings/secrets/actions). Check that the required secrets are there, including \`CODEX_API_KEY\` for Codex, before rerunning the setup check.

**Check what was guessed about your build:**

${guesses}

Proofed checks this pull request with those commands too. If one of them is wrong, its comment below says which failed and what it printed.

Docs: https://github.com/t1dem/proofed
`;
};

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
  const android = "target" in commands;
  const baseCommit = await gh<{ tree: { sha: string } }>(token, "GET", `/repos/${name}/git/commits/${head.object.sha}`);
  const tree = await gh<{ sha: string }>(token, "POST", `/repos/${name}/git/trees`, {
    base_tree: baseCommit.tree.sha,
    tree: [
      { path: ".github/workflows/proofed.yml", mode: "100644", type: "blob", content: workflow(commands, `${appSlug}[bot]`) },
      { path: ".proofed/scenarios/home.md", mode: "100644", type: "blob", content: android ? FIRST_ANDROID_SCENARIO : FIRST_SCENARIO },
    ],
  });
  const commit = await gh<{ sha: string }>(token, "POST", `/repos/${name}/git/commits`, {
    message: `Add Proofed: ${android ? "Android" : "browser"} checks with Kane CLI on every PR`,
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
