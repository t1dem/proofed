// Job credentials an agent must not see, and must not get into a commit, a report or the dashboard.
import { existsSync, readFileSync, statSync } from "node:fs";

// Not given to Claude or Codex. The agent's own key is added back by its runner.
export const JOB_SECRETS = [
  "GITHUB_TOKEN", "GH_TOKEN", "LT_USERNAME", "LT_ACCESS_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CODEX_API_KEY",
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL", "ACTIONS_RUNTIME_TOKEN", "ACTIONS_RUNTIME_URL",
];
const VALUES = ["GITHUB_TOKEN", "GH_TOKEN", "LT_ACCESS_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CODEX_API_KEY", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_RUNTIME_TOKEN"];

export function withoutJobSecrets(env: NodeJS.ProcessEnv, keep: string[] = []) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => keep.includes(name) || !JOB_SECRETS.includes(name)));
}

// The values as they appear in the clear and in the forms git and HTTP headers carry them.
// Longest first, so masking a short value never leaves part of a longer one.
export function secretValues(env: NodeJS.ProcessEnv = process.env) {
  const raw = VALUES.flatMap((name) => (env[name] && env[name]!.length >= 8 ? [env[name]!] : []));
  const encoded = raw.flatMap((v) => [Buffer.from(`x-access-token:${v}`).toString("base64"), Buffer.from(v).toString("base64")]);
  return [...new Set([...raw, ...encoded])].sort((a, b) => b.length - a.length);
}

export const maskSecrets = (text: string, values = secretValues()) => values.reduce((t, v) => t.replaceAll(v, "***"), text);

// The first of `files` that holds a job credential. An agent can still read the credentials of the
// job's own processes (/proc/<pid>/environ), so what it writes is checked before anything leaves the runner.
export function fileWithSecret(files: string[], values = secretValues()) {
  if (values.length === 0) return undefined;
  return files.find((file) => {
    if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size > 20 * 1024 * 1024) return false;
    const text = readFileSync(file, "latin1");
    return values.some((v) => text.includes(v));
  });
}
