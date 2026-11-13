// Verifies the OIDC tokens GitHub Actions hands a job that has `id-token: write`. No imports, so
// the action's tests (Node) can load it as well as the Worker.
export const ACTIONS_ISSUER = "https://token.actions.githubusercontent.com";

export type ActionsClaims = {
  iss: string;
  aud: string | string[];
  exp: number;
  nbf?: number;
  repository?: string;
  repository_id?: string;
  [claim: string]: unknown;
};

type Jwk = JsonWebKey & { kid?: string };
type KeyLookup = (kid: string) => Promise<Jwk | undefined>;

// Clocks on GitHub's side and Cloudflare's may disagree by a few seconds; a token isn't "not yet valid" over that.
const SKEW = 60;

const bytes = (b64url: string) => {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
};
const json = (b64url: string) => JSON.parse(new TextDecoder().decode(bytes(b64url))) as unknown;

// The claims of a token GitHub signed for `audience` and that is valid now, or undefined. Only RS256
// is accepted: the header can't pick "none" or an HMAC keyed with the public key.
export async function verifyActionsToken(
  jwt: string,
  { audience, key, now = Date.now() }: { audience: string; key: KeyLookup; now?: number },
): Promise<ActionsClaims | undefined> {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return undefined;
    const [head = "", body = "", signature = ""] = parts;
    const header = json(head) as { alg?: unknown; kid?: unknown };
    if (header.alg !== "RS256" || typeof header.kid !== "string") return undefined;
    const jwk = await key(header.kid);
    if (jwk?.kty !== "RSA" || !jwk.n || !jwk.e) return undefined;
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signed = new TextEncoder().encode(`${head}.${body}`);
    if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, bytes(signature), signed))) return undefined;

    const claims = json(body) as Partial<ActionsClaims>;
    const seconds = now / 1000;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== ACTIONS_ISSUER || !audiences.includes(audience)) return undefined;
    if (typeof claims.exp !== "number" || claims.exp <= seconds) return undefined;
    if (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > seconds + SKEW)) return undefined;
    return claims as ActionsClaims;
  } catch {
    // Not base64, not JSON, not a key Web Crypto takes: not a token.
    return undefined;
  }
}

const JWKS = `${ACTIONS_ISSUER}/.well-known/jwks`;
const KEYS_LAST = 60 * 60_000;
// GitHub rotates its keys, so an unknown kid fetches the set again, but at most this often: otherwise
// anyone posting tokens with made-up kids would make every request a fetch to GitHub.
const REFETCH_AFTER = 60_000;
let keys: { at: number; list: Jwk[] } | undefined;

export async function actionsKey(kid: string): Promise<Jwk | undefined> {
  const find = () => keys?.list.find((k) => k.kid === kid);
  const age = keys ? Date.now() - keys.at : Infinity;
  if (age < KEYS_LAST && find()) return find();
  if (age < REFETCH_AFTER) return undefined;
  const res = await fetch(JWKS);
  if (!res.ok) throw new Error(`JWKS: ${res.status}`);
  keys = { at: Date.now(), list: ((await res.json()) as { keys?: Jwk[] }).keys ?? [] };
  return find();
}
