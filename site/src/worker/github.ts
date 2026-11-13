// GitHub App plumbing for the Worker: app JWT, installation tokens, webhook signatures, REST calls.
import { memo } from "./memo";

export type AppEnv = {
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string; // PKCS#8 PEM
  GITHUB_WEBHOOK_SECRET: string;
};

const b64url = (data: ArrayBuffer | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

// Valid for nine minutes; signed again after five.
const appJwt = (env: AppEnv) => memo("app-jwt", 5 * 60_000, () => signAppJwt(env));

async function signAppJwt(env: AppEnv) {
  const der = Uint8Array.from(atob(env.GITHUB_APP_PRIVATE_KEY.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID }))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(signature)}`;
}

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function gh<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "proofed-worker",
      ...(body !== undefined && { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new GitHubError(res.status, `${method} ${path}: ${res.status} ${await res.text()}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

// An installation token lasts an hour; reuse it until ten minutes before that.
export const installationToken = (env: AppEnv, installationId: number) =>
  memo(
    `installation:${installationId}`,
    ({ expires }) => expires - Date.now() - 10 * 60_000,
    async () => {
      const { token, expires_at } = await gh<{ token: string; expires_at: string }>(
        await appJwt(env),
        "POST",
        `/app/installations/${installationId}/access_tokens`,
      );
      return { token, expires: Date.parse(expires_at) };
    },
  ).then((t) => t.token);

export const appRequest = async <T>(env: AppEnv, method: string, path: string, body?: unknown) =>
  gh<T>(await appJwt(env), method, path, body);

// X-Hub-Signature-256 is "sha256=" + hex HMAC of the raw body; subtle.verify compares in constant time.
export async function verifySignature(secret: string, body: string, header: string | null) {
  const hex = header?.startsWith("sha256=") ? header.slice(7) : "";
  if (hex.length !== 64) return false;
  const sig = Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(body));
}
