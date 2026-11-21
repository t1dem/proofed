// Job credentials an agent must not see, and must not get into a commit, a report or the dashboard.
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

// Not given to Claude or Codex. The agent's own key is added back by its runner.
export const JOB_SECRETS = [
  "GITHUB_TOKEN", "GH_TOKEN", "LT_USERNAME", "LT_ACCESS_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CODEX_API_KEY", "CODEX_AUTH_JSON",
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL", "ACTIONS_RUNTIME_TOKEN", "ACTIONS_RUNTIME_URL",
];
const VALUES = ["GITHUB_TOKEN", "GH_TOKEN", "LT_ACCESS_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CODEX_API_KEY", "CODEX_AUTH_JSON", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_RUNTIME_TOKEN"];

export function withoutJobSecrets(env: NodeJS.ProcessEnv, keep: string[] = []) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => keep.includes(name) || !JOB_SECRETS.includes(name)));
}

// The Codex login while the fix loop keeps it off disk for the app's build and server (fixworkspace.ts),
// so output from that time is still masked.
let heldCodexAuth: string | undefined;
export const holdCodexAuth = (auth: string | undefined) => { heldCodexAuth = auth; };

// Only read the auth file that the action staged for this run. While the login is held, a file in its
// place is the app's, not the login.
function codexAuth(env: NodeJS.ProcessEnv) {
  if (env.CODEX_AUTH_JSON) return env.CODEX_AUTH_JSON;
  if (!env.PROOFED_CODEX_HOME) return undefined;
  if (heldCodexAuth !== undefined) return heldCodexAuth;
  try {
    return readFileSync(join(env.PROOFED_CODEX_HOME, "auth.json"), "utf8");
  } catch {
    return undefined;
  }
}

// The values as they appear in the clear and in the forms git and HTTP headers carry them.
// Longest first, so masking a short value never leaves part of a longer one.
export function secretValues(env: NodeJS.ProcessEnv = process.env) {
  const auth = codexAuth(env);
  const values: unknown[] = VALUES.map((name) => name === "CODEX_AUTH_JSON" ? auth : env[name]);
  if (auth) {
    try {
      const json = JSON.parse(auth) as { tokens?: Record<string, unknown>; OPENAI_API_KEY?: unknown } | null;
      values.push(json?.OPENAI_API_KEY, json?.tokens?.access_token, json?.tokens?.refresh_token, json?.tokens?.id_token);
    } catch { /* The raw value is still masked. */ }
  }
  const raw = values.filter((value): value is string => typeof value === "string" && value.length >= 8);
  const encoded = raw.flatMap((v) => [Buffer.from(`x-access-token:${v}`).toString("base64"), Buffer.from(v).toString("base64")]);
  return [...new Set([...raw, ...encoded])].sort((a, b) => b.length - a.length);
}

export const maskSecrets = (text: string, values = secretValues()) => values.reduce((t, v) => t.replaceAll(v, "***"), text);

// The first of `files` that holds a job credential. An agent can still read the credentials of the
// job's own processes (/proc/<pid>/environ), so what it writes is checked before anything leaves the runner.
export function fileWithSecret(files: string[], values = secretValues()) {
  if (values.length === 0) return undefined;
  const needles = values.map((value) => Buffer.from(value));
  const overlap = Math.max(1, ...needles.map((value) => value.length)) - 1;
  const chunk = 64 * 1024;
  const buffer = Buffer.allocUnsafe(chunk + overlap);
  return files.find((file) => {
    if (!statSync(file, { throwIfNoEntry: false })?.isFile()) return false;
    const fd = openSync(file, "r");
    try {
      let kept = 0;
      for (;;) {
        const read = readSync(fd, buffer, kept, chunk, null);
        if (read === 0) return false;
        const scanned = buffer.subarray(0, kept + read);
        if (needles.some((value) => scanned.includes(value))) return true;
        // A credential can start in this chunk and end in the next one.
        kept = Math.min(scanned.length, overlap);
        scanned.copy(buffer, 0, scanned.length - kept);
      }
    } finally {
      closeSync(fd);
    }
  });
}
