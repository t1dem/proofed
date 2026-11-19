// Pushing a commit Proofed made (the agent's fix or the setup PR's scenarios) to the PR branch.
import { execFileSync } from "node:child_process";
import { oidcToken, proofedServer } from "../action/server.ts";
import { changesLfsFiles, git, LFS_REFUSAL } from "./fixworkspace.ts";

// GitHub suppresses push workflows from the job's GITHUB_TOKEN and requires approval for PR
// workflows it triggers. Proofed's server trades the job's OIDC token for a repository-scoped
// app token so those workflows can start automatically. Without it, use the job's token.
async function appToken() {
  const { ACTIONS_ID_TOKEN_REQUEST_URL: url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: bearer, PROOFED_SERVER: server } = process.env;
  if (!url || !bearer || !server) {
    console.log(`${url && bearer ? "No Proofed server set" : "The workflow has no `id-token: write`"}: pushing with the job's token.`);
    return undefined;
  }
  try {
    const exchange = new URL("/api/actions/token", proofedServer(server));
    const signal = AbortSignal.timeout(10_000);
    const value = await oidcToken(signal);
    const res = await fetch(exchange, { method: "POST", headers: { authorization: `Bearer ${value}` }, signal });
    const { token } = res.ok ? ((await res.json()) as { token?: string }) : {};
    if (!token) throw new Error(`${exchange.origin} answered ${res.status}`);
    console.log(`::add-mask::${token}`);
    return token;
  } catch (e) {
    console.log(`Couldn't get the Proofed app's token (${e instanceof Error ? e.message : e}): pushing with the job's token.`);
    return undefined;
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

// HEAD to `branch`, as the Proofed app when it can be, otherwise with the job's token. Returns
// whether the app pushed it.
export async function pushHead(branch: string) {
  // Hook-free pushes do not upload new Git LFS objects.
  const paths = git("diff-tree", "--root", "--no-commit-id", "-r", "--no-renames", "--diff-filter=AMT", "--name-only", "-z", "HEAD").split("\0").filter(Boolean);
  if (changesLfsFiles(paths, true)) throw new Error(LFS_REFUSAL);
  const token = await appToken();
  const jobToken = process.env.GITHUB_TOKEN || undefined;
  const ref = `refs/heads/${branch}`;
  const sha = git("rev-parse", "HEAD");
  try {
    push(ref, sha, token ?? jobToken);
    return !!token;
  } catch (e) {
    if (!token) throw e;
    console.log(`Pushing as the Proofed app failed (${e instanceof Error ? e.message.split("\n")[0] : e}): pushing with the job's token.`);
    push(ref, sha, jobToken);
    return false;
  }
}
