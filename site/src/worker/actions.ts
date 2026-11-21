// Calls from a Proofed run, authenticated by the OIDC token GitHub gives its job.
//
// POST /api/actions/push: the fixer's commit (or the setup PR's scenarios) pushed to the PR's branch by
// the Proofed app. A push made with the job's own GITHUB_TOKEN leaves the workflows on that commit
// waiting for someone to approve them; an app's push doesn't. The Worker makes the push itself and
// never hands an app token to the job, because code running inside a Proofed job (the app's install,
// build and serve commands, the fixer) can read the job's OIDC request token and would otherwise get an
// hour-long token that can push to any branch of the repository.
//
// Who can push what:
// - The repository comes only from the signed `repository_id` claim, and GitHub signs that for the
//   repository the job runs in. A workflow in any other repository (an attacker's, or a fork) can only
//   push to its own repository, and only if the Proofed app is installed there.
// - A pull request from a fork runs `pull_request` workflows in the base repository, but GitHub turns
//   every write permission of such a run into read, `id-token` included, so it can't call this.
// - Only jobs in this repository's `.github/workflows/proofed.yml` are accepted.
// - The push goes only to the head branch of an open pull request from this same repository, only as
//   one new commit on top of the branch as it is (never a force push), and never touches workflow files.
//   The commit must come out byte for byte as the job made it (same tree and commit hash), so the run's
//   report names the commit that is really on the branch. Code inside the job can do no more with this
//   than push to the pull request branch it is already running on.
import { readUpTo } from "./body";
import { appRequest, gh, GitHubError } from "./github";
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

// A fix is a few files; scenarios are text. Base64 makes it a third larger.
export const MAX_PUSH_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 1000;

type Person = { name: string; email: string; date: string };
type FileChange = { path: string; mode: "100644" | "100755" | "120000"; sha: string | null; content?: string };
export type PushRequest = {
  branch: string;
  commit: { sha: string; tree: string; parent: string; message: string; author: Person; committer: Person };
  files: FileChange[];
};

const SHA = /^[0-9a-f]{40}$/;
const isSha = (v: unknown): v is string => typeof v === "string" && SHA.test(v);
const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
// What `git check-ref-format --branch` would take, minus anything unusual.
export const validBranch = (b: unknown): b is string =>
  typeof b === "string" && b.length > 0 && b.length <= 255 && /^[\w./-]+$/.test(b) && !b.startsWith("-") && !b.startsWith("/") &&
  !b.endsWith("/") && !b.endsWith(".") && !b.endsWith(".lock") && !b.includes("..") && !b.includes("//") && !b.includes("/.") && !b.startsWith(".");
// A repository-relative path that can't climb out, name Git's own directory or touch workflows (the app
// has no `workflows` permission, so GitHub would refuse those anyway).
export const allowedPath = (p: unknown): p is string => {
  if (typeof p !== "string" || p.length === 0 || p.length > 4096 || p.includes("\0") || p.includes("\\")) return false;
  const parts = p.split("/");
  if (parts.some((s) => s === "" || s === "." || s === ".." || s.toLowerCase() === ".git")) return false;
  return !(parts[0]!.toLowerCase() === ".github" && parts[1]?.toLowerCase() === "workflows");
};
const isPerson = (v: unknown): v is Person => {
  const p = v as Person;
  return !!p && typeof p === "object" && isText(p.name, 256) && isText(p.email, 256) && typeof p.date === "string" &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)$/.test(p.date);
};

export function parsePush(value: unknown): PushRequest | undefined {
  const v = value as PushRequest;
  if (!v || typeof v !== "object" || !validBranch(v.branch) || !Array.isArray(v.files) || v.files.length > MAX_FILES) return undefined;
  const c = v.commit;
  if (!c || typeof c !== "object" || !isSha(c.sha) || !isSha(c.tree) || !isSha(c.parent) || !isText(c.message, 65_536) || !isPerson(c.author) || !isPerson(c.committer)) return undefined;
  const seen = new Set<string>();
  for (const f of v.files) {
    if (!f || typeof f !== "object" || !allowedPath(f.path) || seen.has(f.path) || !["100644", "100755", "120000"].includes(f.mode)) return undefined;
    seen.add(f.path);
    if (f.sha === null) {
      if (f.content !== undefined) return undefined;
    } else if (!isSha(f.sha) || typeof f.content !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(f.content)) return undefined;
  }
  return {
    branch: v.branch,
    commit: { sha: c.sha, tree: c.tree, parent: c.parent, message: c.message, author: c.author, committer: c.committer },
    files: v.files.map((f) => (f.sha === null ? { path: f.path, mode: f.mode, sha: null } : { path: f.path, mode: f.mode, sha: f.sha, content: f.content })),
  };
}

const conflict = (error: string) => Response.json({ error }, { status: 409 });

export async function handleActionsPush(request: Request, env: Env) {
  const job = await jobRepo(request);
  if (!job) return refuse();
  const { repo, repoId } = job;
  const bytes = await readUpTo(request, MAX_PUSH_BYTES);
  if (!bytes) return Response.json({ error: "Too large." }, { status: 413 });
  let push: PushRequest | undefined;
  try {
    push = parsePush(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    push = undefined;
  }
  if (!push) return Response.json({ error: "Send the commit as Proofed's action does." }, { status: 400 });
  const { branch, commit, files } = push;

  let token: string;
  try {
    const installation = await appRequest<{ id: number }>(env, "GET", `/repos/${repo}/installation`);
    // By id, not name: a repository renamed or re-created under the same name since the token was signed isn't this one.
    ({ token } = await appRequest<{ token: string }>(env, "POST", `/app/installations/${installation.id}/access_tokens`, {
      repository_ids: [repoId],
      permissions: { contents: "write", pull_requests: "read" },
    }));
  } catch (e) {
    // 404: the app isn't installed on that repository. 422: the installation can't grant it.
    if (e instanceof GitHubError && (e.status === 404 || e.status === 422)) {
      console.log("actions push refused", repo, e.status);
      return refuse();
    }
    throw e;
  }

  try {
    const owner = repo.split("/")[0]!;
    const pulls = await gh<{ head: { ref: string; repo: { id: number } | null }; base: { repo: { default_branch?: string } } }[]>(
      token, "GET", `/repos/${repo}/pulls?state=open&per_page=100&head=${encodeURIComponent(`${owner}:${branch}`)}`,
    );
    const pull = pulls.find((p) => p.head.ref === branch && p.head.repo?.id === repoId && p.base.repo.default_branch !== branch);
    if (!pull) return conflict("Proofed only pushes to the branch of an open pull request in this repository.");

    const ref = `heads/${branch.split("/").map(encodeURIComponent).join("/")}`;
    const tip = await gh<{ object: { sha: string } }>(token, "GET", `/repos/${repo}/git/ref/${ref}`);
    if (tip.object.sha !== commit.parent) return conflict("The branch moved on since this run checked it out.");
    const parent = await gh<{ tree: { sha: string } }>(token, "GET", `/repos/${repo}/git/commits/${commit.parent}`);

    for (const f of files) {
      if (f.sha === null) continue;
      const blob = await gh<{ sha: string }>(token, "POST", `/repos/${repo}/git/blobs`, { content: f.content, encoding: "base64" });
      if (blob.sha !== f.sha) return conflict(`${f.path} isn't the file the run committed.`);
    }
    const tree = await gh<{ sha: string }>(token, "POST", `/repos/${repo}/git/trees`, {
      base_tree: parent.tree.sha,
      tree: files.map((f) => ({ path: f.path, mode: f.mode, type: "blob", sha: f.sha })),
    });
    if (tree.sha !== commit.tree) return conflict("The tree differs from the one the run committed.");
    const made = await gh<{ sha: string }>(token, "POST", `/repos/${repo}/git/commits`, {
      message: commit.message, tree: tree.sha, parents: [commit.parent], author: commit.author, committer: commit.committer,
    });
    // Nothing points at it yet, so a mismatch leaves the branch as it was.
    if (made.sha !== commit.sha) return conflict("The commit differs from the one the run made.");
    await gh(token, "PATCH", `/repos/${repo}/git/refs/${ref}`, { sha: made.sha, force: false });
    return Response.json({ sha: made.sha }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    // A missing branch, a protected branch, a lost race: the action pushes with the job's token instead.
    if (e instanceof GitHubError && [404, 409, 422].includes(e.status)) {
      console.log("actions push failed", repo, e.status);
      return conflict("GitHub didn't take the push.");
    }
    throw e;
  }
}
