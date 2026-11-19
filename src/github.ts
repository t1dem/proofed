import { readFileSync } from "node:fs";
import { env } from "./env.ts";

export type Repo = { owner: string; name: string; token: string };

export const repoFromEnv = (token: string): Repo => {
  const [owner = "", name = ""] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
  return { owner, name, token };
};

export function readEvent<T>(): Partial<T> {
  return process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) : {};
}

export const ctx = () => {
  const token = process.env.GITHUB_TOKEN;
  return {
    repo: token && process.env.GITHUB_REPOSITORY ? repoFromEnv(token) : undefined,
    runUrl: process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined,
    outDir: env("PROOFED_OUT", ".proofed-out"),
  };
};

async function request<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const send = () => fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // A dropped connection ("fetch failed") ended a whole run after Kane had finished. Requests that
  // are safe to repeat get two more tries; a POST might already have landed, so it doesn't.
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await send();
      if (!res.ok) throw new GitHubError(res.status, `${method} ${path}: ${res.status} ${await res.text()}`);
      return (res.status === 204 ? undefined : await res.json()) as T;
    } catch (e) {
      if (method === "POST" || attempt === 3 || !(e instanceof TypeError)) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

const api = <T>(repo: Repo, method: string, path: string, body?: unknown) =>
  request<T>(repo.token, method, `/repos/${repo.owner}/${repo.name}${path}`, body);

export type PullRequest = {
  number: number;
  body: string | null;
  base: { sha: string; ref: string };
  head: { sha: string; ref: string };
  draft?: boolean;
  user?: { login: string };
};

export const getPermission = async (repo: Repo, username: string) =>
  (await api<{ permission: string }>(repo, "GET", `/collaborators/${encodeURIComponent(username)}/permission`)).permission;

export const getPullRequest = (repo: Repo, number: number) => api<PullRequest>(repo, "GET", `/pulls/${number}`);

type Entry = { name: string; type: string; content?: string };

// A folder's entries at `ref`, or undefined when there is no folder there.
export async function listFolder(repo: Repo, path: string, ref: string) {
  try {
    const found = await api<Entry | Entry[]>(repo, "GET", `/contents/${path}?ref=${ref}`);
    return Array.isArray(found) ? found : undefined;
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return undefined;
    throw e;
  }
}

export async function readFile(repo: Repo, path: string, ref: string) {
  const file = await api<Entry>(repo, "GET", `/contents/${path}?ref=${ref}`);
  return Buffer.from(file.content ?? "", "base64").toString("utf8");
}

// 👀 on a /proofed comment, so whoever asked sees it was picked up.
export const acknowledge = (repo: Repo, commentId: number) =>
  api(repo, "POST", `/issues/comments/${commentId}/reactions`, { content: "eyes" });

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const MARKER = "<!-- proofed -->";
// A report a newer one replaced carries this instead. Neither the fix trigger in the installed workflows
// nor the dashboard's webhook matches it, so an edit of an old report is never read as the PR's report.
export const OLD_MARKER = "<!-- proofed:old -->";

export type Comment = { id: number; node_id: string; html_url: string; body?: string; user?: { type: string; id?: number } };

// The marker is public; report authors must be bots or the user whose token posts the report.
export function reportsIn(comments: Comment[], userId?: number) {
  const reports = comments.filter((c) => c.body?.includes(MARKER) && (c.user?.type === "Bot" || (userId !== undefined && c.user?.id === userId)));
  return { current: reports.at(-1), older: reports.slice(0, -1) };
}

const identities = new WeakMap<Repo, Promise<number | undefined>>();

function authenticatedUser(repo: Repo) {
  const known = identities.get(repo);
  if (known) return known;
  const identity = request<{ id: number }>(repo.token, "GET", "/user").then(({ id }) => id).catch((e: unknown) => {
    // App and installation tokens have no user endpoint.
    if (e instanceof GitHubError && (e.status === 401 || e.status === 403 || e.status === 404)) return undefined;
    identities.delete(repo);
    throw e;
  });
  identities.set(repo, identity);
  return identity;
}

// Every page: a report is posted afresh further down a long thread, past the first hundred comments.
export async function listReports(repo: Repo, pr: number) {
  const comments: Comment[] = [];
  for (let page = 1; ; page++) {
    const batch = await api<Comment[]>(repo, "GET", `/issues/${pr}/comments?per_page=100&page=${page}`);
    comments.push(...batch);
    if (batch.length < 100) {
      const userId = comments.some((c) => c.user?.type !== "Bot" && c.user?.id !== undefined && c.body?.includes(MARKER))
        ? await authenticatedUser(repo)
        : undefined;
      return reportsIn(comments, userId);
    }
  }
}

export const findReport = async (repo: Repo, pr: number) => (await listReports(repo, pr)).current;

export const reply = (repo: Repo, pr: number, body: string) => api(repo, "POST", `/issues/${pr}/comments`, { body });

export const postComment = (repo: Repo, pr: number, body: string) => api<Comment>(repo, "POST", `/issues/${pr}/comments`, { body });

export const editComment = (repo: Repo, id: number, body: string) => api<Comment>(repo, "PATCH", `/issues/comments/${id}`, { body });

// Folded on GitHub as outdated. A token that may comment but not minimize only leaves it unfolded.
export async function minimize(repo: Repo, nodeId: string) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${repo.token}`, "content-type": "application/json" },
    body: JSON.stringify({
      query: "mutation($id: ID!) { minimizeComment(input: { subjectId: $id, classifier: OUTDATED }) { minimizedComment { isMinimized } } }",
      variables: { id: nodeId },
    }),
  });
  // GraphQL reports most errors with a 200.
  const answer = (await res.json().catch(() => ({}))) as { errors?: { message: string }[] };
  if (!res.ok || answer.errors?.length) throw new GitHubError(res.status, `minimizeComment: ${res.status} ${answer.errors?.map((e) => e.message).join("; ") ?? ""}`);
}

const STATUS = "Proofed";

export const hasStatus = async (repo: Repo, sha: string) =>
  (await api<{ statuses: { context: string }[] }>(repo, "GET", `/commits/${sha}/status`)).statuses.some((s) => s.context === STATUS);

export function setStatus(
  repo: Repo,
  sha: string,
  state: "pending" | "success" | "failure" | "error",
  description: string,
  targetUrl?: string,
) {
  return api(repo, "POST", `/statuses/${sha}`, {
    state,
    context: STATUS,
    description: description.slice(0, 140),
    ...(targetUrl && { target_url: targetUrl }),
  });
}

const CLIPS_BRANCH = "proofed-clips";

// Clips go to an orphan branch of the same repo, so the repo needs no storage of its own.
// Links go through github.com/…/raw/…, not raw.githubusercontent.com: for a private repo GitHub
// redirects a signed-in viewer to a tokened raw URL, so the GIF still renders in the PR comment.
export function clipUrl(repo: Repo, path: string) {
  return `https://github.com/${repo.owner}/${repo.name}/raw/${CLIPS_BRANCH}/${path}`;
}

export async function publishClips(repo: Repo, files: { path: string; local: string }[]) {
  if (files.length === 0) return;

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
}
