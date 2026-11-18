// Pushing a commit Proofed made (the agent's fix or the setup PR's scenarios) to the PR branch.
import { execFileSync } from "node:child_process";
import { oidcToken } from "./server.ts";

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
    const value = await oidcToken();
    const res = await fetch(new URL("/api/actions/token", server), { method: "POST", headers: { authorization: `Bearer ${value}` } });
    const { token } = res.ok ? ((await res.json()) as { token?: string }) : {};
    if (!token) throw new Error(`${server} answered ${res.status}`);
    console.log(`::add-mask::${token}`);
    return token;
  } catch (e) {
    console.log(`Couldn't get the Proofed app's token (${e instanceof Error ? e.message : e}): pushing with the job's token.`);
    return undefined;
  }
}

function push(branch: string, token?: string) {
  const refspec = `HEAD:${branch}`;
  if (!token) return void execFileSync("git", ["push", "origin", refspec], { encoding: "utf8" });

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
  execFileSync("git", ["push", "--", remote, refspec], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_ALLOW_PROTOCOL: "https",
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: header,
      GIT_CONFIG_VALUE_0: "",
      GIT_CONFIG_KEY_1: header,
      GIT_CONFIG_VALUE_1: `AUTHORIZATION: basic ${basic}`,
    },
  });
}

// HEAD to `branch`, as the Proofed app when it can be, otherwise with the job's token. Returns
// whether the app pushed it.
export async function pushHead(branch: string) {
  const token = await appToken();
  const jobToken = process.env.GITHUB_TOKEN || undefined;
  try {
    push(branch, token ?? jobToken);
    return !!token;
  } catch (e) {
    if (!token) throw e;
    console.log(`Pushing as the Proofed app failed (${e instanceof Error ? e.message.split("\n")[0] : e}): pushing with the job's token.`);
    push(branch, jobToken);
    return false;
  }
}
