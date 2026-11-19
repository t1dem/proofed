import { executableCommand } from "../process.ts";
import { maskSecrets, secretValues } from "../secrets.ts";
// Whether Kane can start a run: signed in with `kane-cli login`, or given LT_USERNAME and
// LT_ACCESS_KEY, which Proofed passes to every run. `proofed check` asks before it builds anything:
// without a working login every run ends at once, and a retry ends the same way.
import { execFile } from "node:child_process";

export const LOGIN_FIX = "kane-cli login (or export LT_USERNAME and LT_ACCESS_KEY from TestMu: Settings → Keys)";
export const KEYS_FIX = "LT_USERNAME and LT_ACCESS_KEY: copy both again from TestMu (Settings → Keys), in the GitHub repository secrets too, or unset them to use kane-cli login";

// What `kane-cli run` prints on stderr when it can't start for want of a login (kane-cli 0.10):
// "Not authenticated. Run: kane-cli login --oauth, or kane-cli login --username <user> --access-key <key>"
// and `kane-cli balance`: 'Not authenticated [prod]. Run "kane-cli login" first.'
export const NOT_SIGNED_IN = /\bnot authenticated\b|\bnot (?:logged|signed) in\b|\btoken (?:missing|expired|invalid)\b/i;

// What TestMu answers a login or keys it doesn't accept, through `kane-cli balance` (kane-cli 0.10):
// 'Error: Credit balance request failed: 401 {"error":"authentication failed"}'
const REJECTED = /\b40[13]\b|\bauthentication failed\b|\bcredentials not valid\b|\bunauthori[sz]ed\b/i;

export const kaneCredentials = (env: NodeJS.ProcessEnv) =>
  env.LT_USERNAME?.trim() && env.LT_ACCESS_KEY?.trim() ? ["--username", env.LT_USERNAME.trim(), "--access-key", env.LT_ACCESS_KEY.trim()] : [];

export function kaneSecretValues(env: NodeJS.ProcessEnv) {
  const secrets = secretValues(env);
  const key = env.LT_ACCESS_KEY?.trim();
  if (!key || key === env.LT_ACCESS_KEY) return secrets;
  // Kane can echo the trimmed key passed on its command line.
  return [...new Set([...secrets, ...secretValues({ LT_ACCESS_KEY: key })])].sort((a, b) => b.length - a.length);
}

export type Login = {
  state: "signed_in" | "keys" | "not_signed_in" | "keys_rejected" | "unknown";
  detail: string;
  // What `kane-cli balance` printed when it answered.
  balance?: string;
};

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const NOTICE = /^(?:update available|skill update available)\b/i;

// The line Kane gives its reason in, without the update notices it prints around it.
const reasonIn = (output: string) =>
  output
    .replace(ANSI, "")
    .split("\n")
    .map((l) => l.trim().replace(/^error:\s*/i, ""))
    .filter((l) => l && !NOTICE.test(l))
    .at(-1) ?? "";

// `kane-cli balance` is free and asks TestMu with the login or the keys a run would use, so a
// missing, expired or wrong one shows here and not after the build. `whoami` only reads the local
// login: it can't tell a wrong key from a good one. A balance that can't be started, doesn't answer
// or fails for another reason (no network) says nothing either way, and the check goes on.
export function kaneLogin(bin: string, env: NodeJS.ProcessEnv, timeout = 20_000): Promise<Login> {
  const creds = kaneCredentials(env);
  const secrets = kaneSecretValues(env);
  return new Promise((resolve) => {
    try {
      const cmd = executableCommand(bin, ["balance", ...creds], env);
      execFile(cmd.file, cmd.args, { env, timeout, windowsHide: true }, (error, stdout, stderr) => {
        const output = `${stdout}\n${stderr}`.replace(ANSI, "");
        if (!error) {
          return resolve(creds.length ? { state: "keys", detail: "LT_USERNAME and LT_ACCESS_KEY work; Kane uses them", balance: output } : { state: "signed_in", detail: "signed in", balance: output });
        }
        const e = error as NodeJS.ErrnoException & { killed?: boolean };
        if (e.killed || typeof e.code !== "number") return resolve({ state: "unknown", detail: `kane-cli balance didn't answer${e.killed ? ` within ${timeout / 1000} s` : `: ${maskSecrets(e.message, secrets)}`}` });
        const said = maskSecrets(reasonIn(output), secrets);
        if (REJECTED.test(output) || NOT_SIGNED_IN.test(output)) {
          return resolve(
            creds.length
              ? { state: "keys_rejected", detail: `Kane rejected LT_USERNAME and LT_ACCESS_KEY${said ? ` (${said})` : ""}` }
              : { state: "not_signed_in", detail: REJECTED.test(output) ? `the login was rejected${said ? ` (${said})` : ""}` : "not signed in" },
          );
        }
        resolve({ state: "unknown", detail: `kane-cli balance failed${said ? `: ${said}` : ` with exit ${e.code}`}` });
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      resolve({ state: "unknown", detail: `kane-cli balance didn't answer: ${maskSecrets(message, secrets)}` });
    }
  });
}
