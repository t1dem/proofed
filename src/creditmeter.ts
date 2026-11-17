import { mkdirSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { kaneLogin } from "./kaneauth.ts";

const LOCK = "/tmp/proofed-kane.lock";

export async function creditMeter(env: NodeJS.ProcessEnv, lock = LOCK) {
  let owned = false;
  try { mkdirSync(lock); owned = true; writeFileSync(`${lock}/meter`, String(process.pid)); }
  catch {
    // A competing Proofed run invalidates attribution for the lock owner too.
    try { if (existsSync(`${lock}/meter`)) writeFileSync(`${lock}/contended`, ""); } catch {}
  }
  const balance = async () => {
    const login = await kaneLogin(env.KANE_CLI ?? "kane-cli", env);
    const value = /^Available credits:\s*(\d+(?:\.\d+)?)\s*$/im.exec(login.balance ?? "")?.[1];
    return value === undefined ? undefined : Number(value);
  };
  // The CLI has no transaction ledger. A balance delta can include remote account
  // activity, which no local process scan or filesystem lock can rule out.
  const before = owned ? await balance() : undefined;
  return async () => {
    try {
      const after = before === undefined ? undefined : await balance();
      return before !== undefined && after !== undefined && after <= before && !existsSync(`${lock}/contended`)
        ? { before, after, debit: Math.round((before - after) * 10_000) / 10_000 }
        : undefined;
    } finally { if (owned) rmSync(lock, { recursive: true, force: true }); }
  };
}
