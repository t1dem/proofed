import { currentUser, userToken, type UserRow } from "./auth";
import { decrypt, encrypt, sealForGitHub } from "./crypto";
import { gh, GitHubError, installationToken } from "./github";
import type { Env } from "./index";
import { DEFAULT_FIXER, EFFORTS, MODELS, type Fixer } from "./models";
import { openSetupPr } from "./setup";

export const SECRET_NAMES = ["LT_USERNAME", "LT_ACCESS_KEY", "CLAUDE_CODE_OAUTH_TOKEN"] as const;

export type RepoView = {
  name: string;
  url: string;
  private: boolean;
  installationId: number;
  setup: "active" | "pr-open" | "none";
  setupPr?: string;
  secrets: string[];
  // null when Proofed can't read the repo's Actions variables (the installation predates that permission).
  fixer: Fixer | null;
  report?: { state: string; headline: string; url: string; pr: number; updatedAt: number };
};

export type MeView = {
  login: string;
  avatar: string | null;
  testmu: string | null; // username when connected
  claude: boolean;
  installUrl: string;
};

const json = (data: unknown, status = 200) => Response.json(data, { status });

type Installation = { id: number; account: { login: string } };
type InstallationRepo = { id: number; full_name: string; html_url: string; private: boolean };

async function listRepos(env: Env, token: string) {
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

  const [active, prs, secrets, fixer, report] = await Promise.all([
    exists(".github/workflows/proofed.yml"),
    gh<{ html_url: string }[]>(token, "GET", `/repos/${repo.full_name}/pulls?head=${repo.full_name.split("/")[0]}:proofed-setup&state=open`),
    gh<{ secrets: { name: string }[] }>(token, "GET", `/repos/${repo.full_name}/actions/secrets?per_page=100`).then(
      (r) => r.secrets.map((s) => s.name),
      () => [],
    ),
    gh<{ variables: { name: string; value: string }[] }>(token, "GET", `/repos/${repo.full_name}/actions/variables?per_page=30`).then(
      ({ variables }) => ({
        model: variables.find((v) => v.name === "PROOFED_MODEL")?.value || DEFAULT_FIXER.model,
        effort: variables.find((v) => v.name === "PROOFED_EFFORT")?.value || DEFAULT_FIXER.effort,
      }),
      () => null,
    ),
    env.DB.prepare("SELECT * FROM reports WHERE repo = ?1 ORDER BY updated_at DESC LIMIT 1")
      .bind(repo.full_name)
      .first<{ state: string; headline: string; url: string; pr: number; updated_at: number }>(),
  ]);

  return {
    name: repo.full_name,
    url: repo.html_url,
    private: repo.private,
    installationId: repo.installationId,
    setup: active ? "active" : prs[0] ? "pr-open" : "none",
    setupPr: prs[0]?.html_url,
    secrets: secrets.filter((s) => (SECRET_NAMES as readonly string[]).includes(s)),
    fixer,
    report: report
      ? { state: report.state, headline: report.headline, url: report.url, pr: report.pr, updatedAt: report.updated_at }
      : undefined,
  };
}

// Puts the user's keys into one repo's Actions secrets, sealed with that repo's public key.
export async function pushSecrets(env: Env, user: UserRow, repoName: string, installationId: number) {
  const values: Record<(typeof SECRET_NAMES)[number], string | undefined> = {
    LT_USERNAME: user.lt_username ?? undefined,
    LT_ACCESS_KEY: await decrypt(env.SECRETS_KEY, user.lt_key),
    CLAUDE_CODE_OAUTH_TOKEN: await decrypt(env.SECRETS_KEY, user.claude_token),
  };
  const token = await installationToken(env, installationId);
  const { key, key_id } = await gh<{ key: string; key_id: string }>(token, "GET", `/repos/${repoName}/actions/secrets/public-key`);
  const pushed: string[] = [];
  for (const name of SECRET_NAMES) {
    const value = values[name];
    if (!value) continue;
    await gh(token, "PUT", `/repos/${repoName}/actions/secrets/${name}`, { encrypted_value: sealForGitHub(key, value), key_id });
    pushed.push(name);
  }
  return pushed;
}

// The fix workflow reads vars.PROOFED_MODEL / PROOFED_EFFORT; the default is stored as no variable at all.
async function setFixer(token: string, repoName: string, fixer: Fixer) {
  const vars = [
    ["PROOFED_MODEL", fixer.model, DEFAULT_FIXER.model],
    ["PROOFED_EFFORT", fixer.effort, DEFAULT_FIXER.effort],
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
      installUrl: `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`,
    };
    return json(me);
  }

  if (path === "/api/repos" && request.method === "GET") {
    const repos = await listRepos(env, token);
    return json(await Promise.all(repos.map((r) => describeRepo(env, r))));
  }

  if (path === "/api/keys" && request.method === "POST") {
    const body = (await request.json()) as { ltUsername?: string; ltAccessKey?: string; claudeToken?: string };
    const updates: string[] = [];
    const binds: unknown[] = [];

    if (body.ltUsername !== undefined || body.ltAccessKey !== undefined) {
      const username = body.ltUsername?.trim() ?? "";
      const key = body.ltAccessKey?.trim() ?? "";
      if (!username || !key) return json({ error: "TestMu needs both a username and an access key." }, 400);
      if (!(await testmuKeyWorks(username, key))) return json({ error: "TestMu didn't accept that username and access key." }, 400);
      updates.push("lt_username = ?", "lt_key = ?");
      binds.push(username, await encrypt(env.SECRETS_KEY, key));
    }
    if (body.claudeToken !== undefined) {
      const claude = body.claudeToken.trim();
      if (!claude.startsWith("sk-ant-")) return json({ error: "That doesn't look like a token from `claude setup-token`." }, 400);
      updates.push("claude_token = ?");
      binds.push(await encrypt(env.SECRETS_KEY, claude));
    }
    if (updates.length === 0) return json({ error: "Nothing to save." }, 400);

    await env.DB.prepare(`UPDATE users SET ${updates.join(", ")}, updated_at = ? WHERE id = ?`)
      .bind(...binds, Date.now(), user.id)
      .run();
    const fresh = (await env.DB.prepare("SELECT * FROM users WHERE id = ?1").bind(user.id).first<UserRow>())!;

    // New keys go straight into every repo this user has connected.
    const repos = await listRepos(env, token);
    const synced = await Promise.allSettled(repos.map((r) => pushSecrets(env, fresh, r.full_name, r.installationId)));
    return json({ ok: true, synced: synced.filter((s) => s.status === "fulfilled").length, of: repos.length });
  }

  const repoAction = /^\/api\/repos\/([^/]+)\/([^/]+)\/(setup|secrets|fixer)$/.exec(path);
  if (repoAction && request.method === "POST") {
    const [, owner, name, action] = repoAction;
    const repo = (await listRepos(env, token)).find((r) => r.full_name === `${owner}/${name}`);
    if (!repo) return json({ error: "Proofed isn't installed on that repository." }, 404);
    if (action === "fixer") {
      const body = (await request.json()) as Partial<Fixer>;
      if (!MODELS.some((m) => m.id === body.model) || !EFFORTS.some((e) => e === body.effort)) {
        return json({ error: "Pick one of the listed models and effort levels." }, 400);
      }
      const fixer = { model: body.model!, effort: body.effort! };
      try {
        await setFixer(await installationToken(env, repo.installationId), repo.full_name, fixer);
      } catch (e) {
        if (e instanceof GitHubError && e.status === 403) {
          return json({ error: "Proofed needs the new Variables permission on this repo. Accept it on GitHub, then try again." }, 403);
        }
        throw e;
      }
      return json({ fixer });
    }
    if (action === "setup") {
      const result = await openSetupPr(await installationToken(env, repo.installationId), repo);
      return json(result);
    }
    return json({ pushed: await pushSecrets(env, user, repo.full_name, repo.installationId) });
  }

  return json({ error: "not_found" }, 404);
}
