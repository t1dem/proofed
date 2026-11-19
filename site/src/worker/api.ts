import { currentUser, userToken, type UserRow } from "./auth";
import { readJsonObject } from "./body";
import { decrypt, encrypt, sealForGitHub } from "./crypto";
import { gh, GitHubError, installationToken } from "./github";
import type { Env } from "./index";
import { forget, memo } from "./memo";
import { DEFAULT_FIXER, isProvider, resolveFixer, type Fixer } from "./models";
import { getLive, liveFrame } from "./live";
import { getPull, listPulls, markAsked } from "./runs";
import { openSetupPr } from "./setup";

export const SECRET_NAMES = ["LT_USERNAME", "LT_ACCESS_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CODEX_API_KEY"] as const;

// `auto`: "Fix automatically", a check that saw a scenario fail goes on to fix it (src/action/mode.ts).
export type FixerView = Fixer & { auto: boolean };

export type RepoView = {
  name: string;
  url: string;
  private: boolean;
  installationId: number;
  // What the signed-in user may change here: keys need admin, everything else write access.
  access: Access;
  setup: "active" | "pr-open" | "none";
  setupPr?: string;
  // The workflow is switched off on GitHub: pull requests aren't checked until it's switched back on.
  paused: boolean;
  secrets: string[];
  // null when Proofed can't read the repo's Actions variables (the installation predates that permission).
  fixer: FixerView | null;
  report?: { state: string; headline: string; url: string; pr: number; updatedAt: number };
};

export type MeView = {
  login: string;
  avatar: string | null;
  testmu: string | null; // username when connected
  claude: boolean;
  codex: boolean;
  installUrl: string;
};

const json = (data: unknown, status = 200) => Response.json(data, { status });

const WORKFLOW = "proofed.yml";
const CLIP_TYPES = { mp4: "video/mp4", gif: "image/gif", jpg: "image/jpeg" };

// "/clip/<owner>/<repo>/pr-<n>/<run>/<file>": a clip on the repo's proofed-clips branch.
export const CLIP_PATH = /^\/clip\/([^/]+\/[^/]+)\/(pr-\d+\/[\w.-]+\/[\w.-]+\.(mp4|gif|jpg))$/;

// Without a token only a public repository's clips are there to read.
export async function serveClip(request: Request, token: string | undefined, repoName: string, file: string, ext: string) {
  // raw.githubusercontent.com takes the app's token and answers Range requests, which video seeking needs.
  const range = request.headers.get("range");
  const res = await fetch(`https://raw.githubusercontent.com/${repoName}/proofed-clips/${file}`, {
    headers: { ...(token && { authorization: `token ${token}` }), ...(range && { range }) },
  });
  if (!res.ok) return json({ error: "That clip isn't on the proofed-clips branch." }, res.status === 404 ? 404 : 502);
  const headers = new Headers({
    "content-type": CLIP_TYPES[ext as keyof typeof CLIP_TYPES],
    "accept-ranges": "bytes",
    // A clip's folder is named after its commit and run, so its bytes never change.
    "cache-control": "private, max-age=31536000, immutable",
  });
  for (const name of ["content-length", "content-range"]) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers });
}

type Installation = { id: number; account: { login: string } };
// `permissions` is the signed-in user's, as /user/installations/{id}/repositories answers it.
type InstallationRepo = { id: number; full_name: string; html_url: string; private: boolean; permissions?: { admin?: boolean; push?: boolean } };

export type Access = "admin" | "write" | "read";
const accessOf = (repo: InstallationRepo): Access => (repo.permissions?.admin ? "admin" : repo.permissions?.push ? "write" : "read");

// Every API call starts here, so the answer is kept for a minute per user token.
const listRepos = (env: Env, token: string) => memo(`repos:${token}`, 60_000, () => fetchRepos(token));

async function fetchRepos(token: string) {
  const { installations } = await gh<{ installations: Installation[] }>(token, "GET", "/user/installations?per_page=100");
  const perInstallation = await Promise.all(
    installations.map(async (inst) => {
      const { repositories } = await gh<{ repositories: InstallationRepo[] }>(
        token,
        "GET",
        `/user/installations/${inst.id}/repositories?per_page=100`,
      );
      return repositories.map((r) => ({ ...r, installationId: inst.id }));
    }),
  );
  return perInstallation.flat();
}

type RepoVariable = { name: string; value: string };

async function repoVariables(token: string, repoName: string) {
  const all: RepoVariable[] = [];
  const path = `/repos/${repoName}/actions/variables?per_page=100`;
  for (let page = 1; ; page++) {
    const { variables, total_count } = await gh<{ variables: RepoVariable[]; total_count: number }>(
      token, "GET", page === 1 ? path : `${path}&page=${page}`,
    );
    all.push(...variables);
    if (all.length >= total_count || variables.length === 0) return all;
  }
}

export const repoFixer = (token: string, repoName: string) => memo(`fixer:${repoName}`, 60_000, () =>
  repoVariables(token, repoName).then(
    (variables) => {
      const provider = variables.find((v) => v.name === "PROOFED_PROVIDER")?.value;
      const choice = resolveFixer({
        ...(provider && isProvider(provider) ? { provider } : {}),
        model: variables.find((v) => v.name === "PROOFED_MODEL")?.value,
        effort: variables.find((v) => v.name === "PROOFED_EFFORT")?.value,
      });
      return {
        ...("error" in choice ? DEFAULT_FIXER : choice),
        auto: variables.find((v) => v.name === "PROOFED_AUTOFIX")?.value === "true",
      };
    },
    () => null,
  ),
);

const installedFixer = (env: Env, repo: InstallationRepo & { installationId: number }) =>
  installationToken(env, repo.installationId).then((token) => repoFixer(token, repo.full_name)).catch(() => null);

// Uses the installation token: it can read workflow files and secret names the user token can't.
async function describeRepo(env: Env, repo: InstallationRepo & { installationId: number }): Promise<RepoView> {
  const token = await installationToken(env, repo.installationId);
  const exists = (path: string) =>
    gh(token, "GET", `/repos/${repo.full_name}/contents/${path}`).then(
      () => true,
      (e: unknown) => {
        if (e instanceof GitHubError && e.status === 404) return false;
        throw e;
      },
    );

  const [active, paused, prs, secrets, fixer, report] = await Promise.all([
    exists(".github/workflows/proofed.yml"),
    gh<{ state: string }>(token, "GET", `/repos/${repo.full_name}/actions/workflows/${WORKFLOW}`).then(
      (w) => w.state === "disabled_manually",
      () => false,
    ),
    gh<{ html_url: string }[]>(token, "GET", `/repos/${repo.full_name}/pulls?head=${repo.full_name.split("/")[0]}:proofed-setup&state=open`),
    gh<{ secrets: { name: string }[] }>(token, "GET", `/repos/${repo.full_name}/actions/secrets?per_page=100`).then(
      (r) => r.secrets.map((s) => s.name),
      () => [],
    ),
    repoFixer(token, repo.full_name),
    env.DB.prepare("SELECT * FROM reports WHERE repo = ?1 ORDER BY updated_at DESC LIMIT 1")
      .bind(repo.full_name)
      .first<{ state: string; headline: string; url: string; pr: number; updated_at: number }>(),
  ]);

  return {
    name: repo.full_name,
    url: repo.html_url,
    private: repo.private,
    installationId: repo.installationId,
    access: accessOf(repo),
    setup: active ? "active" : prs[0] ? "pr-open" : "none",
    setupPr: prs[0]?.html_url,
    paused: active && paused,
    secrets: secrets.filter((s) => (SECRET_NAMES as readonly string[]).includes(s)),
    fixer,
    report: report
      ? { state: report.state, headline: report.headline, url: report.url, pr: report.pr, updatedAt: report.updated_at }
      : undefined,
  };
}

// Whether a repo's Proofed workflow is switched off on GitHub. Pause and resume in Settings forget it.
const isPaused = (env: Env, repo: InstallationRepo & { installationId: number }) =>
  memo(`paused:${repo.full_name}`, 60_000, async () => {
    const token = await installationToken(env, repo.installationId);
    const workflow = await gh<{ state: string }>(token, "GET", `/repos/${repo.full_name}/actions/workflows/${WORKFLOW}`).catch(() => undefined);
    return workflow?.state === "disabled_manually";
  }).catch(() => false);

async function pausedRepos(env: Env, repos: (InstallationRepo & { installationId: number })[]) {
  const paused = await Promise.all(repos.map(async (r) => ((await isPaused(env, r)) ? [r.full_name] : [])));
  return new Set(paused.flat());
}

// Puts the user's keys into one repo's Actions secrets, sealed with that repo's public key.
export async function pushSecrets(env: Env, user: Pick<UserRow, "lt_username" | "lt_key" | "claude_token" | "codex_key">, repoName: string, installationId: number) {
  const values: Record<(typeof SECRET_NAMES)[number], string | undefined> = {
    LT_USERNAME: user.lt_username ?? undefined,
    LT_ACCESS_KEY: await decrypt(env.SECRETS_KEY, user.lt_key),
    CLAUDE_CODE_OAUTH_TOKEN: await decrypt(env.SECRETS_KEY, user.claude_token),
    CODEX_API_KEY: await decrypt(env.SECRETS_KEY, user.codex_key),
  };
  const token = await installationToken(env, installationId);
  const { key, key_id } = await gh<{ key: string; key_id: string }>(token, "GET", `/repos/${repoName}/actions/secrets/public-key`);
  const names = SECRET_NAMES.filter((name) => values[name]);
  const results = await Promise.allSettled(names.map((name) =>
    gh(token, "PUT", `/repos/${repoName}/actions/secrets/${name}`, { encrypted_value: sealForGitHub(key, values[name]!), key_id }),
  ));
  const failed = results.find((r) => r.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return names;
}

export async function syncSecrets(env: Env, user: Pick<UserRow, "lt_username" | "lt_key" | "claude_token" | "codex_key">, repoName: string, installationId: number) {
  const pushed = await pushSecrets(env, user, repoName, installationId);
  if (pushed.includes("CODEX_API_KEY") && !pushed.includes("CLAUDE_CODE_OAUTH_TOKEN")) {
    try {
      const warning = await selectCodex(await installationToken(env, installationId), repoName);
      if (warning) return { pushed, warning };
    } catch (e) {
      console.error("Codex setup", repoName, e);
      return { pushed, warning: "Proofed couldn't select Codex automatically. Choose Codex in repository settings." };
    }
  }
  return { pushed };
}

async function selectCodex(token: string, repoName: string) {
  const actions = `/repos/${repoName}/actions`;
  const hasClaude = await gh(token, "GET", `${actions}/secrets/CLAUDE_CODE_OAUTH_TOKEN`).then(
    () => true,
    (e: unknown) => {
      if (e instanceof GitHubError && e.status === 404) return false;
      throw e;
    },
  );
  if (hasClaude) return;

  // Keep an explicit fixer choice. A new setup with only a Codex key otherwise defaults to Claude.
  try {
    const variables = await repoVariables(token, repoName);
    if (variables.some(({ name }) => name === "PROOFED_PROVIDER" || name === "PROOFED_MODEL")) return;
    await gh(token, "POST", `${actions}/variables`, { name: "PROOFED_PROVIDER", value: "codex" });
    forget(`fixer:${repoName}`);
  } catch (e) {
    if (e instanceof GitHubError && e.status === 403) {
      return "To select Codex, accept the Variables permission on GitHub, then choose Codex in repository settings.";
    }
    throw e;
  }
}

// The workflow reads vars.PROOFED_MODEL / PROOFED_EFFORT / PROOFED_AUTOFIX; a default is stored as no variable at all.
async function setFixer(token: string, repoName: string, fixer: FixerView) {
  const vars = [
    ["PROOFED_PROVIDER", fixer.provider || "claude", "claude"],
    ["PROOFED_MODEL", fixer.model, DEFAULT_FIXER.model],
    ["PROOFED_EFFORT", fixer.effort, DEFAULT_FIXER.effort],
    ["PROOFED_AUTOFIX", fixer.auto ? "true" : "", ""],
  ] as const;
  for (const [name, value, fallback] of vars) {
    const path = `/repos/${repoName}/actions/variables`;
    const missing = (e: unknown) => e instanceof GitHubError && e.status === 404;
    if (value === fallback) {
      await gh(token, "DELETE", `${path}/${name}`).catch((e: unknown) => {
        if (!missing(e)) throw e;
      });
    } else {
      await gh(token, "PATCH", `${path}/${name}`, { name, value }).catch((e: unknown) => {
        if (missing(e)) return gh(token, "POST", path, { name, value });
        throw e;
      });
    }
  }
}

async function testmuKeyWorks(username: string, key: string) {
  const res = await fetch("https://api.lambdatest.com/automation/api/v1/builds?limit=1", {
    headers: { authorization: `Basic ${btoa(`${username}:${key}`)}` },
  });
  return res.ok;
}

export async function handleApi(request: Request, env: Env, path: string) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "signed_out" }, 401);
  const token = await userToken(env, user);
  if (!token) return json({ error: "signed_out" }, 401);

  if (path === "/api/me" && request.method === "GET") {
    const me: MeView = {
      login: user.login,
      avatar: user.avatar,
      testmu: user.lt_key ? user.lt_username : null,
      claude: !!user.claude_token,
      codex: !!user.codex_key,
      installUrl: `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`,
    };
    return json(me);
  }

  if (path === "/api/repos" && request.method === "GET") {
    const repos = await listRepos(env, token);
    return json(await Promise.all(repos.map((r) => describeRepo(env, r))));
  }

  if (path === "/api/keys" && request.method === "POST") {
    const body = await readJsonObject(request);
    if (!body) return json({ error: "Send the keys as a JSON object." }, 400);
    const { ltUsername, ltAccessKey, claudeToken, codexKey } = body;
    if ([ltUsername, ltAccessKey, claudeToken, codexKey].some((v) => v !== undefined && typeof v !== "string")) {
      return json({ error: "Keys and usernames must be text." }, 400);
    }
    const updates: string[] = [];
    const binds: unknown[] = [];

    if (ltUsername !== undefined || ltAccessKey !== undefined) {
      const username = typeof ltUsername === "string" ? ltUsername.trim() : "";
      const key = typeof ltAccessKey === "string" ? ltAccessKey.trim() : "";
      if (!username || !key) return json({ error: "TestMu needs both a username and an access key." }, 400);
      if (!(await testmuKeyWorks(username, key))) return json({ error: "TestMu didn't accept that username and access key." }, 400);
      updates.push("lt_username = ?", "lt_key = ?");
      binds.push(username, await encrypt(env.SECRETS_KEY, key));
    }
    if (typeof claudeToken === "string") {
      const claude = claudeToken.trim();
      if (!claude.startsWith("sk-ant-")) return json({ error: "That doesn't look like a token from `claude setup-token`." }, 400);
      updates.push("claude_token = ?");
      binds.push(await encrypt(env.SECRETS_KEY, claude));
    }
    if (typeof codexKey === "string") {
      const key = codexKey.trim();
      if (!key.startsWith("sk-") || key.length < 20) return json({ error: "That doesn't look like an OpenAI API key." }, 400);
      updates.push("codex_key = ?");
      binds.push(await encrypt(env.SECRETS_KEY, key));
    }
    if (updates.length === 0) return json({ error: "Nothing to save." }, 400);

    await env.DB.prepare(`UPDATE users SET ${updates.join(", ")}, updated_at = ? WHERE id = ?`)
      .bind(...binds, Date.now(), user.id)
      .run();
    const fresh = (await env.DB.prepare("SELECT * FROM users WHERE id = ?1").bind(user.id).first<UserRow>())!;

    // New keys go straight into every repo this user has connected and administers.
    const repos = (await listRepos(env, token)).filter((r) => accessOf(r) === "admin");
    const results = await Promise.allSettled(repos.map((r) => syncSecrets(env, fresh, r.full_name, r.installationId)));
    const synced = results.flatMap((r) => r.status === "fulfilled" ? [r.value] : []);
    const warning = [...new Set(synced.flatMap((r) => r.warning ? [r.warning] : []))].join(" ");
    return json({ ok: true, synced: synced.length, of: repos.length, ...(warning && { warning }) });
  }

  if (path === "/api/pulls" && request.method === "GET") {
    const repos = await listRepos(env, token);
    const pulls = await listPulls(env, repos.map((r) => r.full_name));
    const paused = await pausedRepos(env, repos.filter((r) => pulls.some((p) => p.repo === r.full_name)));
    const readOnly = new Set(repos.filter((r) => accessOf(r) === "read").map((r) => r.full_name));
    const fixers = new Map(await Promise.all(repos.filter((r) => pulls.some((p) => p.repo === r.full_name)).map(async (r) =>
      [r.full_name, await installedFixer(env, r)] as const)));
    return json(pulls.map((p) => ({ ...p, fixer: fixers.get(p.repo) ?? undefined, paused: paused.has(p.repo), readOnly: readOnly.has(p.repo) })));
  }

  const clip = CLIP_PATH.exec(path.slice("/api".length));
  if (clip && request.method === "GET") {
    const [, repoName = "", file = "", ext = ""] = clip;
    const repo = (await listRepos(env, token)).find((r) => r.full_name === repoName);
    if (!repo) return json({ error: "Proofed isn't installed on that repository." }, 404);
    return serveClip(request, await installationToken(env, repo.installationId), repoName, file, ext);
  }

  // A run as it goes, while the pull request is busy: its state, and each scenario's latest frame.
  const live = /^\/api\/pulls\/([^/]+\/[^/]+)\/(\d+)\/live(?:\/([^/]+)\.jpg)?$/.exec(path);
  if (live && request.method === "GET") {
    const [, repoName = "", number, scenario] = live;
    if (!(await listRepos(env, token)).some((r) => r.full_name === repoName)) return json({ error: "Proofed isn't installed on that repository." }, 404);
    if (scenario) return liveFrame(env, repoName, Number(number), decodeURIComponent(scenario));
    return json(await getLive(env, repoName, Number(number)));
  }

  const pull = /^\/api\/pulls\/([^/]+\/[^/]+)\/(\d+)(?:\/(fix|rerun|check))?$/.exec(path);
  if (pull) {
    const [, repoName = "", number, action] = pull;
    const repo = (await listRepos(env, token)).find((r) => r.full_name === repoName);
    if (!repo) return json({ error: "Proofed isn't installed on that repository." }, 404);
    if (!action && request.method === "GET") {
      const [detail, paused] = await Promise.all([getPull(env, repoName, Number(number)), pausedRepos(env, [repo])]);
      if (!detail) return json({ error: "Proofed hasn't reported on that pull request." }, 404);
      const fixer = await installedFixer(env, repo);
      return json({ ...detail, pull: { ...detail.pull, fixer: fixer ?? undefined, paused: paused.has(repoName), readOnly: accessOf(repo) === "read" } });
    }
    if (action && request.method === "POST") {
      // On a public repo anyone can comment, but the workflow ignores /proofed from people without write access.
      if (accessOf(repo) === "read") return json({ error: "You need write access to this repository." }, 403);
      let command = action === "fix" ? "/proofed fix" : "/proofed";
      if (action === "check") {
        // "/proofed <what to check>": one line, as the workflow reads it. "fix …" would start a fix instead.
        const what = (await readJsonObject(request))?.what;
        const text = typeof what === "string" ? what.replace(/\s+/g, " ").trim().slice(0, 300) : "";
        if (!text) return json({ error: "Say what Kane should check." }, 400);
        if (/^fix\b/i.test(text)) return json({ error: "That would start a fix. Use the Fix button for that." }, 400);
        command = `/proofed ${text}`;
      }
      // The workflow listens for these comments, and only from people with write access:
      // posted with the user's own token, the comment is theirs.
      try {
        await gh(token, "POST", `/repos/${repoName}/issues/${number}/comments`, { body: command });
      } catch (e) {
        if (e instanceof GitHubError && [403, 404, 410, 422].includes(e.status)) {
          return json({ error: `GitHub didn't let Proofed comment for you. Open the pull request and post ${command}`, retryable: true }, 403);
        }
        throw e;
      }
      // The workflow only reports when it's done; until then the pull request shows it's on its way.
      await markAsked(env, repoName, Number(number), action === "fix" ? "fix" : "rerun");
      return json({ ok: true });
    }
  }

  const repoAction = /^\/api\/repos\/([^/]+)\/([^/]+)\/(setup|secrets|fixer|pause|resume)$/.exec(path);
  if (repoAction && request.method === "POST") {
    const [, owner, name, action] = repoAction;
    const repo = (await listRepos(env, token)).find((r) => r.full_name === `${owner}/${name}`);
    if (!repo) return json({ error: "Proofed isn't installed on that repository." }, 404);
    const access = accessOf(repo);
    if (action === "secrets" && access !== "admin") return json({ error: "Adding keys needs admin access to this repository." }, 403);
    if (access === "read") return json({ error: "You need write access to this repository." }, 403);
    if (action === "fixer") {
      const body = await readJsonObject(request);
      if (!body) return json({ error: "Send the fixer settings as a JSON object." }, 400);
      const { model, effort, provider, auto } = body;
      if (typeof model !== "string" || !model.trim() || typeof effort !== "string" || !effort.trim()) {
        return json({ error: "Choose a model and effort." }, 400);
      }
      if (provider !== undefined && (typeof provider !== "string" || !isProvider(provider))) return json({ error: "Pick Claude or Codex." }, 400);
      if (auto !== undefined && typeof auto !== "boolean") return json({ error: "Automatic fixes must be either on or off." }, 400);
      const choice = resolveFixer({ model: model.trim().toLowerCase(), effort, provider });
      if ("error" in choice) return json({ error: choice.error }, 400);
      const fixer = { ...choice, auto: auto === true };
      try {
        await setFixer(await installationToken(env, repo.installationId), repo.full_name, fixer);
      } catch (e) {
        if (e instanceof GitHubError && e.status === 403) {
          return json({ error: "Proofed needs the new Variables permission on this repo. Accept it on GitHub, then try again." }, 403);
        }
        throw e;
      } finally {
        // GitHub may have applied some of the writes before a later one failed.
        forget(`fixer:${repo.full_name}`);
      }
      return json({ fixer });
    }
    // Pause switches the repo's Proofed workflow off on GitHub; nothing in the repo changes.
    if (action === "pause" || action === "resume") {
      const token = await installationToken(env, repo.installationId);
      await gh(token, "PUT", `/repos/${repo.full_name}/actions/workflows/${WORKFLOW}/${action === "pause" ? "disable" : "enable"}`);
      forget(`paused:${repo.full_name}`);
      return json({ paused: action === "pause" });
    }
    if (action === "setup") {
      const result = await openSetupPr(await installationToken(env, repo.installationId), repo, env.GITHUB_APP_SLUG);
      return json(result);
    }
    return json(await syncSecrets(env, user, repo.full_name, repo.installationId));
  }

  return json({ error: "not_found" }, 404);
}
