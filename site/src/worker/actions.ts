// POST /api/actions/token: a Proofed run trades the OIDC token GitHub gave its job for a short-lived
// token of the Proofed GitHub App that can push to that job's repository and nothing else. The fixer
// pushes Claude's commit with it: a push made with the job's own GITHUB_TOKEN leaves the workflows on
// that commit waiting for someone to approve them, an app's push doesn't.
//
// Who can get what:
// - The repository comes only from the signed `repository_id` claim, and GitHub signs that for the
//   repository the job runs in. A workflow in any other repository (an attacker's, or a fork) gets a
//   token for its own repository, and only if the Proofed app is installed there, which means its
//   owner installed it: nothing they couldn't do already. There is no way to name another repository.
// - A pull request from a fork runs `pull_request` workflows in the base repository, but GitHub turns
//   every write permission of such a run into read, `id-token` included, so it can't ask for a token
//   (unless an admin turned on "Send write tokens to workflows from pull requests").
// - Only jobs in this repository's `.github/workflows/proofed.yml` can get this token. Other workflows
//   with `id-token: write` are refused. Code running inside a Proofed job (install, build, Claude) can
//   get it. It grants the same branch pushes as the job's GITHUB_TOKEN with `contents: write`,
//   which branch protection still guards.
//   What it adds: the push starts workflows, it lasts an hour instead of until the job ends, and it is
//   attributed to the app. It has no `workflows` permission, so it can't change workflow files, and no
//   other permission at all (no secrets, issues, pull requests or settings).
// - A stolen OIDC token is worth the same, for the few minutes until it expires.
import { appRequest, GitHubError } from "./github";
import type { Env } from "./index";
import { actionsKey, verifyActionsToken } from "./oidc";

export const AUDIENCE = "proofed";

// Every refusal looks the same: a caller learns nothing about which check it failed.
const refuse = () => Response.json({ error: "unauthorized" }, { status: 401 });

// The repository whose Proofed workflow sent this request, from its OIDC token; undefined for anyone else.
export async function jobRepo(request: Request) {
  const jwt = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  const claims = jwt ? await verifyActionsToken(jwt, { audience: AUDIENCE, key: actionsKey }) : undefined;
  const repo = claims?.repository;
  const repoId = Number(claims?.repository_id);
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !Number.isSafeInteger(repoId) || repoId <= 0) return undefined;
  const workflow = `${repo}/.github/workflows/proofed.yml@`;
  if (typeof claims?.workflow_ref !== "string" || !claims.workflow_ref.startsWith(workflow) || claims.workflow_ref.length === workflow.length) return undefined;
  return { repo, repoId };
}

export async function handleActionsToken(request: Request, env: Env) {
  const job = await jobRepo(request);
  if (!job) return refuse();
  const { repo, repoId } = job;

  try {
    const installation = await appRequest<{ id: number }>(env, "GET", `/repos/${repo}/installation`);
    // By id, not name: a repository renamed or re-created under the same name since the token was signed isn't this one.
    const { token } = await appRequest<{ token: string }>(env, "POST", `/app/installations/${installation.id}/access_tokens`, {
      repository_ids: [repoId],
      permissions: { contents: "write" },
    });
    return Response.json({ token }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    // 404: the app isn't installed on that repository. 422: the installation can't grant it.
    if (e instanceof GitHubError && (e.status === 404 || e.status === 422)) {
      console.log("actions token refused", repo, e.status);
      return refuse();
    }
    throw e;
  }
}
