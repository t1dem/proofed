// Everything sensitive at rest (GitHub tokens, TestMu key, Claude token) is AES-GCM encrypted
// with SECRETS_KEY, so a D1 dump alone reveals nothing usable.
import nacl from "tweetnacl";
import { blake2b } from "@noble/hashes/blake2.js";

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64 = (bytes: Uint8Array) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

const keys = new Map<string, Promise<CryptoKey>>();
const aesKey = (secret: string) => {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", fromB64(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
    keys.set(secret, key);
  }
  return key;
};

export async function encrypt(secret: string, plain: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), new TextEncoder().encode(plain));
  return `${toB64(iv)}.${toB64(new Uint8Array(cipher))}`;
}

export async function decrypt(secret: string, sealed: string | null | undefined) {
  if (!sealed) return undefined;
  const [iv = "", data = ""] = sealed.split(".");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await aesKey(secret), fromB64(data));
  return new TextDecoder().decode(plain);
}

export const randomId = () => toB64(crypto.getRandomValues(new Uint8Array(24))).replace(/[+/=]/g, "");

// GitHub Actions secrets must be libsodium sealed boxes for the repo's public key:
// an ephemeral X25519 key pair, nonce = blake2b(ephemeral_pk || repo_pk), then crypto_box.
export function sealForGitHub(repoPublicKeyB64: string, value: string) {
  const repoKey = fromB64(repoPublicKeyB64);
  const ephemeral = nacl.box.keyPair();
  const nonce = blake2b(new Uint8Array([...ephemeral.publicKey, ...repoKey]), { dkLen: 24 });
  const boxed = nacl.box(new TextEncoder().encode(value), nonce, repoKey, ephemeral.secretKey);
  return toB64(new Uint8Array([...ephemeral.publicKey, ...boxed]));
}
