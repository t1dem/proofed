import { readFileSync } from "node:fs";

export type Repo = { owner: string; name: string; token: string };

export const repoFromEnv = (token: string): Repo => {
  const [owner = "", name = ""] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
  return { owner, name, token };
};

async function api<T>(repo: Repo, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${repo.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new GitHubError(res.status, `${method} ${path}: ${res.status} ${await res.text()}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const MARKER = "<!-- proofed -->";

// One comment per PR, edited in place on every run, so the thread doesn't fill up with bot noise.
export async function upsertComment(repo: Repo, pr: number, body: string) {
  const comments = await api<{ id: number; body?: string }[]>(repo, "GET", `/issues/${pr}/comments?per_page=100`);
  const mine = comments.find((c) => c.body?.includes(MARKER));
  return mine
    ? api<{ html_url: string }>(repo, "PATCH", `/issues/comments/${mine.id}`, { body })
    : api<{ html_url: string }>(repo, "POST", `/issues/${pr}/comments`, { body });
}

export function setStatus(
  repo: Repo,
  sha: string,
  state: "pending" | "success" | "failure" | "error",
  description: string,
  targetUrl?: string,
) {
  return api(repo, "POST", `/statuses/${sha}`, {
    state,
    context: "Proofed",
    description: description.slice(0, 140),
    ...(targetUrl && { target_url: targetUrl }),
  });
}

const CLIPS_BRANCH = "proofed-clips";

// Clips go to an orphan branch of the same repo, so the repo needs no storage of its own.
// Links go through github.com/…/raw/…, not raw.githubusercontent.com: for a private repo GitHub
// redirects a signed-in viewer to a tokened raw URL, so the GIF still renders in the PR comment.
export async function publishClips(repo: Repo, files: { path: string; local: string }[]) {
  if (files.length === 0) return new Map<string, string>();

  for (let attempt = 0; ; attempt++) {
    const parent = await api<{ object: { sha: string } }>(repo, "GET", `/git/ref/heads/${CLIPS_BRANCH}`).catch(
      (e: unknown) => {
        if (e instanceof GitHubError && e.status === 404) return undefined;
        throw e;
      },
    );
    const parentCommit = parent
      ? await api<{ tree: { sha: string } }>(repo, "GET", `/git/commits/${parent.object.sha}`)
      : undefined;

    const tree = await Promise.all(
      files.map(async (f) => {
        const blob = await api<{ sha: string }>(repo, "POST", "/git/blobs", {
          content: readFileSync(f.local).toString("base64"),
          encoding: "base64",
        });
        return { path: f.path, mode: "100644", type: "blob", sha: blob.sha };
      }),
    );
    const newTree = await api<{ sha: string }>(repo, "POST", "/git/trees", {
      tree,
      ...(parentCommit && { base_tree: parentCommit.tree.sha }),
    });
    const commit = await api<{ sha: string }>(repo, "POST", "/git/commits", {
      message: `Clips for ${files[0]?.path.split("/").slice(0, -1).join("/")}`,
      tree: newTree.sha,
      parents: parent ? [parent.object.sha] : [],
    });

    try {
      if (parent) await api(repo, "PATCH", `/git/refs/heads/${CLIPS_BRANCH}`, { sha: commit.sha });
      else await api(repo, "POST", "/git/refs", { ref: `refs/heads/${CLIPS_BRANCH}`, sha: commit.sha });
      break;
    } catch (e) {
      // Another run moved the branch first: rebuild on top of it.
      if (attempt < 3 && e instanceof GitHubError && e.status === 422) continue;
      throw e;
    }
  }

  return new Map(
    files.map((f) => [f.path, `https://github.com/${repo.owner}/${repo.name}/raw/${CLIPS_BRANCH}/${f.path}`]),
  );
}
