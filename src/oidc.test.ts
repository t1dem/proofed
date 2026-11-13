import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTIONS_ISSUER, verifyActionsToken } from "../site/src/worker/oidc.ts";

const alg = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
const github = await crypto.subtle.generateKey(alg, true, ["sign", "verify"]);
const stranger = await crypto.subtle.generateKey(alg, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", github.publicKey)), kid: "k1" };
const key = async (kid: string) => (kid === "k1" ? jwk : undefined);

const b64url = (data: string | ArrayBuffer) => Buffer.from(typeof data === "string" ? data : new Uint8Array(data)).toString("base64url");
const now = Date.parse("2026-11-13T12:00:00Z");
const seconds = now / 1000;
const good = {
  iss: ACTIONS_ISSUER, aud: "proofed", exp: seconds + 300, nbf: seconds - 10, iat: seconds - 10,
  repository: "t1dem/proofed", repository_id: "123", sub: "repo:t1dem/proofed:pull_request",
};

async function sign(claims: object, { header = { alg: "RS256", kid: "k1" } as object, signer = github.privateKey } = {}) {
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signer, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(signature)}`;
}
const verify = (jwt: string) => verifyActionsToken(jwt, { audience: "proofed", key, now });

test("a token GitHub signed for Proofed gives its repository", async () => {
  const claims = await verify(await sign(good));
  assert.equal(claims?.repository, "t1dem/proofed");
  assert.equal(claims?.repository_id, "123");
  assert.equal((await verify(await sign({ ...good, aud: ["sts.amazonaws.com", "proofed"] })))?.repository, "t1dem/proofed");
});

test("a token for someone else, from someone else, or out of date is refused", async () => {
  assert.equal(await verify(await sign({ ...good, aud: "sts.amazonaws.com" })), undefined);
  assert.equal(await verify(await sign({ ...good, aud: undefined })), undefined);
  assert.equal(await verify(await sign({ ...good, iss: "https://token.actions.githubusercontent.com.evil.example" })), undefined);
  assert.equal(await verify(await sign({ ...good, exp: seconds - 1 })), undefined);
  assert.equal(await verify(await sign({ ...good, exp: undefined })), undefined);
  assert.equal(await verify(await sign({ ...good, nbf: seconds + 600 })), undefined);
});

test("a token not signed by GitHub's key is refused", async () => {
  assert.equal(await verify(await sign(good, { signer: stranger.privateKey })), undefined);
  // GitHub's signature over different claims.
  const [head, , signature] = (await sign(good)).split(".");
  const forged = `${head}.${b64url(JSON.stringify({ ...good, repository: "victim/repo", repository_id: "999" }))}.${signature}`;
  assert.equal(await verify(forged), undefined);
  // A key id GitHub doesn't have.
  assert.equal(await verify(await sign(good, { header: { alg: "RS256", kid: "k2" } })), undefined);
});

test("the header can't turn the signature check off or change it", async () => {
  const none = `${b64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${b64url(JSON.stringify(good))}.`;
  assert.equal(await verify(none), undefined);
  assert.equal(await verify(await sign(good, { header: { alg: "none", kid: "k1" } })), undefined);
  assert.equal(await verify(await sign(good, { header: { alg: "HS256", kid: "k1" } })), undefined);
  assert.equal(await verify(await sign(good, { header: { alg: "RS256" } })), undefined);
  assert.equal(await verify("not a token"), undefined);
  assert.equal(await verify("a.b.c"), undefined);
});
