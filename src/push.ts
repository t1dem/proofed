// Pushing a commit Proofed made (Claude's fix, the setup PR's scenarios) to the PR's branch.
import { execFileSync } from "node:child_process";

// Pushed with the job's GITHUB_TOKEN, a commit leaves every workflow on it (the repo's own CI too)
// waiting for someone to approve it; an app's push doesn't. Proofed's server trades this job's OIDC
// token for a token of the Proofed app that can only push to this repository. A workflow without
// `id-token: write` gets no OIDC token, and the commit is pushed as it always was.
async function appToken() {
  const { ACTIONS_ID_TOKEN_REQUEST_URL: url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: bearer, PROOFED_SERVER: server } = process.env;
  if (!url || !bearer || !server) {
    console.log(`${url && bearer ? "No Proofed server set" : "The workflow has no `id-token: write`"}: pushing with the job's token, so GitHub holds the workflows on the commit for approval.`);
    return undefined;
  }
  try {
    const request = new URL(url);
    request.searchParams.set("audience", "proofed");
    const oidc = await fetch(request, { headers: { authorization: `bearer ${bearer}` } });
    const { value } = oidc.ok ? ((await oidc.json()) as { value?: string }) : {};
    if (!value) throw new Error(`GitHub gave no OIDC token (${oidc.status})`);
    console.log(`::add-mask::${value}`);
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

// actions/checkout leaves the job's token in the repo's git config as an auth header for github.com,
// and git would send it instead of any other credentials. Config from the environment is read last:
// the empty value clears that header and the next one replaces it. The token stays out of the command
// line, so a failed push can't print it.
function push(branch: string, token?: string) {
  const args = ["push", "origin", `HEAD:${branch}`];
  if (!token) return void execFileSync("git", args, { encoding: "utf8" });
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  console.log(`::add-mask::${basic}`);
  const header = "http.https://github.com/.extraheader";
  execFileSync("git", args, {
    encoding: "utf8",
    env: {
      ...process.env,
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
  try {
    push(branch, token);
    return !!token;
  } catch (e) {
    if (!token) throw e;
    console.log(`Pushing as the Proofed app failed (${e instanceof Error ? e.message.split("\n")[0] : e}): pushing with the job's token.`);
    push(branch);
    return false;
  }
}
