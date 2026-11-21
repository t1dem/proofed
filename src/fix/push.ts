// Pushing a commit Proofed made (the agent's fix or the setup PR's scenarios) to the PR branch.
import { execFileSync } from "node:child_process";
import { oidcToken, proofedServer } from "../action/server.ts";
import { changesLfsFiles, git, LFS_REFUSAL } from "./fixworkspace.ts";

// GitHub suppresses push workflows from the job's GITHUB_TOKEN and requires approval for PR
// workflows it triggers. So Proofed's server pushes the commit as the Proofed app: the job sends the
// commit's files and metadata with its OIDC token, and the server writes the very same commit (same
// hash) onto the PR branch. No app token ever reaches the job, where the app's own build could read
// it (site/src/worker/actions.ts says what the server accepts). Without the server, or if it refuses,
// the job's token pushes instead.

// "Name <email> 1732190000 +0100" as GitHub's API takes a person: the same instant and offset.
export function person(line: string) {
  const m = /^(.*) <(.*)> (\d+) ([+-])(\d\d)(\d\d)$/.exec(line);
  if (!m) return undefined;
  const [, name = "", email = "", seconds = "", sign = "", hours = "", minutes = ""] = m;
  const offset = (sign === "-" ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
  const local = new Date((Number(seconds) + offset * 60) * 1000).toISOString().replace(/\.\d{3}Z$/, "");
  return { name, email, date: `${local}${sign}${hours}:${minutes}` };
}

const MAX_PUSH_BYTES = 32 * 1024 * 1024;

// HEAD as the server needs it, or undefined when the server couldn't reproduce it exactly
// (a signed or merge commit, a submodule, more than fits in one request).
export function headCommit(branch: string) {
  const raw = execFileSync("git", ["cat-file", "commit", "HEAD"], { encoding: "utf8", maxBuffer: 1024 * 1024 });
  const split = raw.indexOf("\n\n");
  const headers = (split < 0 ? raw : raw.slice(0, split)).split("\n");
  const message = split < 0 ? "" : raw.slice(split + 2);
  const values = (key: string) => headers.filter((l) => l.startsWith(`${key} `)).map((l) => l.slice(key.length + 1));
  const known = new Set(["tree", "parent", "author", "committer"]);
  if (headers.some((l) => !known.has(l.split(" ")[0] ?? ""))) return undefined;
  const [tree] = values("tree");
  const parents = values("parent");
  const author = person(values("author")[0] ?? "");
  const committer = person(values("committer")[0] ?? "");
  if (!tree || parents.length !== 1 || !author || !committer) return undefined;
  const parent = parents[0]!;
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  // Raw entries: ":<old mode> <new mode> <old sha> <new sha> <status>\0<path>\0".
  const entries = execFileSync("git", ["diff-tree", "-r", "-z", "--no-renames", "--no-commit-id", parent, "HEAD"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0");
  const files: { path: string; mode: string; sha: string | null; content?: string }[] = [];
  let size = 0;
  for (let i = 0; i + 1 < entries.length; i += 2) {
    const [oldMode = "", newMode = "", , newSha = "", status = ""] = entries[i]!.slice(1).split(" ");
    const path = entries[i + 1]!;
    if (status === "D") {
      if (oldMode === "160000") return undefined;
      files.push({ path, mode: oldMode, sha: null });
      continue;
    }
    if (!["100644", "100755", "120000"].includes(newMode)) return undefined;
    const content = execFileSync("git", ["cat-file", "blob", newSha], { maxBuffer: MAX_PUSH_BYTES }).toString("base64");
    size += content.length;
    if (size > MAX_PUSH_BYTES * 0.9) return undefined;
    files.push({ path, mode: newMode, sha: newSha, content });
  }
  return { branch, commit: { sha, tree, parent, message, author, committer }, files };
}

// Whether the server pushed HEAD to `branch` as the Proofed app.
async function serverPush(branch: string) {
  const { ACTIONS_ID_TOKEN_REQUEST_URL: url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: bearer, PROOFED_SERVER: server } = process.env;
  if (!url || !bearer || !server) {
    console.log(`${url && bearer ? "No Proofed server set" : "The workflow has no `id-token: write`"}: pushing with the job's token.`);
    return false;
  }
  try {
    const body = headCommit(branch);
    if (!body) {
      console.log("Proofed's server can't recreate this commit exactly: pushing with the job's token.");
      return false;
    }
    const endpoint = new URL("/api/actions/push", proofedServer(server));
    const value = await oidcToken(AbortSignal.timeout(10_000));
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${value}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const answer = (await res.json().catch(() => ({}))) as { sha?: string; error?: string };
    if (!res.ok || answer.sha !== body.commit.sha) throw new Error(`${endpoint.origin} answered ${res.status}${answer.error ? `: ${answer.error}` : ""}`);
    return true;
  } catch (e) {
    console.log(`Proofed's server couldn't push it (${e instanceof Error ? e.message : e}): pushing with the job's token.`);
    return false;
  }
}

function pushDestination(token?: string) {
  if (!token) return { remote: "origin" };

  const server = new URL(process.env.GITHUB_SERVER_URL || "https://github.com");
  const repo = process.env.GITHUB_REPOSITORY;
  if (server.protocol !== "https:" || !repo) throw new Error("A token-authenticated push needs an HTTPS GitHub repository.");
  // Force the HTTPS helper so a runner's HTTPS-to-SSH rewrite can't silently use a human's SSH key.
  const remote = `https::${server.origin}/${repo}`;
  // A checkout that persisted a token left an auth header that git would send instead. Config from the
  // environment is read last: the empty value clears it and the next one replaces it. The token stays
  // out of the command line, so a failed push can't print it.
  const header = `http.${server.origin}/.extraheader`;
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  console.log(`::add-mask::${basic}`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_ALLOW_PROTOCOL: "https",
    GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_KEY_0: header,
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: header,
    GIT_CONFIG_VALUE_1: `AUTHORIZATION: basic ${basic}`,
    // The token must only go to a verified server, whatever the runner or repo config says.
    GIT_CONFIG_KEY_2: "http.sslVerify",
    GIT_CONFIG_VALUE_2: "true",
  };
  // Git skips verification when this variable exists at all, even as "false".
  delete env.GIT_SSL_NO_VERIFY;
  return { remote, env };
}

function push(ref: string, sha: string, token?: string) {
  const { remote, env } = pushDestination(token);
  try {
    execFileSync("git", ["push", "--no-verify", "--", remote, `HEAD:${ref}`], { encoding: "utf8", env });
  } catch (error) {
    // A lost response can make Git fail after the remote has updated the branch.
    try {
      const destinations = token ? [remote] : git("remote", "get-url", "--push", "--all", remote).split("\n");
      const updated = destinations.every((destination) => {
        const refs = execFileSync("git", ["ls-remote", "--refs", "--", destination, ref], { encoding: "utf8", env, timeout: 10_000, stdio: "pipe" });
        return refs.split("\n").includes(`${sha}\t${ref}`);
      });
      if (updated) return;
    } catch {
      // Keep the push error if the branch could not be read.
    }
    throw error;
  }
}

// HEAD to `branch`, as the Proofed app when Proofed's server can push it, otherwise with the job's token. Returns
// whether the app pushed it.
export async function pushHead(branch: string) {
  // Hook-free pushes do not upload new Git LFS objects.
  const paths = git("diff-tree", "--root", "--no-commit-id", "-r", "--no-renames", "--diff-filter=AMT", "--name-only", "-z", "HEAD").split("\0").filter(Boolean);
  if (changesLfsFiles(paths, true)) throw new Error(LFS_REFUSAL);
  if (await serverPush(branch)) return true;
  const ref = `refs/heads/${branch}`;
  const sha = git("rev-parse", "HEAD");
  push(ref, sha, process.env.GITHUB_TOKEN || undefined);
  return false;
}
