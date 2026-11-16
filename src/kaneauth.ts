// Whether Kane can start a run: signed in with `kane-cli login`, or given LT_USERNAME and
// LT_ACCESS_KEY, which Proofed passes to every run. `proofed check` asks before it builds anything:
// without a login every run ends at once, and a retry ends the same way.
import { execFile } from "node:child_process";

export const LOGIN_FIX = "kane-cli login (or export LT_USERNAME and LT_ACCESS_KEY from TestMu: Settings → Keys)";

// What `kane-cli run` prints on stderr when it can't start for want of a login (kane-cli 0.10):
// "Not authenticated. Run: kane-cli login --oauth, or kane-cli login --username <user> --access-key <key>"
export const NOT_SIGNED_IN = /\bnot authenticated\b|\bnot (?:logged|signed) in\b|\btoken (?:missing|expired|invalid)\b/i;

export const kaneCredentials = (env: NodeJS.ProcessEnv) =>
  env.LT_USERNAME?.trim() && env.LT_ACCESS_KEY?.trim() ? ["--username", env.LT_USERNAME.trim(), "--access-key", env.LT_ACCESS_KEY.trim()] : [];

export type Login = { state: "signed_in" | "keys" | "not_signed_in" | "unknown"; detail: string };

// `kane-cli whoami` is free and local: it exits 0 when signed in and 1 when not. One that can't be
// started or doesn't answer says nothing either way, and the check goes on.
export function kaneLogin(bin: string, env: NodeJS.ProcessEnv, timeout = 20_000): Promise<Login> {
  if (kaneCredentials(env).length) return Promise.resolve({ state: "keys", detail: "LT_USERNAME and LT_ACCESS_KEY are set; Kane uses them" });
  return new Promise((resolve) => {
    execFile(bin, ["whoami"], { env, timeout }, (error) => {
      if (!error) return resolve({ state: "signed_in", detail: "signed in" });
      const e = error as NodeJS.ErrnoException & { killed?: boolean };
      if (e.killed || typeof e.code !== "number") return resolve({ state: "unknown", detail: `kane-cli whoami didn't answer${e.killed ? ` within ${timeout / 1000} s` : `: ${e.message}`}` });
      resolve({ state: "not_signed_in", detail: "not signed in" });
    });
  });
}
