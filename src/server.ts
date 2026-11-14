// Proofed's server, as the action talks to it: the job proves which repository it runs in with the
// OIDC token GitHub gives a job that has `id-token: write` (site/src/worker/actions.ts checks it).

// Set when the workflow names a Proofed server and may ask GitHub for an OIDC token.
export const serverUrl = () => {
  const { ACTIONS_ID_TOKEN_REQUEST_URL: url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: bearer, PROOFED_SERVER: server } = process.env;
  return url && bearer && server ? server : undefined;
};

// GitHub's tokens last five minutes; one is reused for four.
const TOKEN_LASTS = 4 * 60_000;
let token: { value: string; at: number } | undefined;

export async function oidcToken() {
  if (token && Date.now() - token.at < TOKEN_LASTS) return token.value;
  const { ACTIONS_ID_TOKEN_REQUEST_URL: url = "", ACTIONS_ID_TOKEN_REQUEST_TOKEN: bearer } = process.env;
  const request = new URL(url);
  request.searchParams.set("audience", "proofed");
  const oidc = await fetch(request, { headers: { authorization: `bearer ${bearer}` } });
  const { value } = oidc.ok ? ((await oidc.json()) as { value?: string }) : {};
  if (!value) throw new Error(`GitHub gave no OIDC token (${oidc.status})`);
  console.log(`::add-mask::${value}`);
  token = { value, at: Date.now() };
  return value;
}
