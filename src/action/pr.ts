import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { PullRequest } from "../github.ts";
import { findGitBash } from "../process.ts";
import { actionError, bash, CommandFailure, output } from "./command.ts";

type Ref = PullRequest["head"] & { repo?: { full_name: string } | null };
type Branches = { head: Ref; base: Ref };

export function fixRefs({ head, base }: Branches) {
  if (!head.repo?.full_name || head.repo.full_name !== base.repo?.full_name) return undefined;
  return { base: base.sha, base_ref: base.ref, head_ref: head.ref };
}

// The fix job has the repository's secrets and pushes to the branch, so only people who could push
// themselves may start it, as the main action's mode.ts requires.
export const canFix = (permission: string | undefined) => permission === "admin" || permission === "write";

const ghApi = (path: string) => {
  const result = spawnSync(findGitBash(), bash("gh", ["api", path]), { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new CommandFailure("gh api", result.status ?? 1);
  return JSON.parse(result.stdout) as unknown;
};

if (import.meta.main) {
  try {
    const repo = process.env.GITHUB_REPOSITORY;
    const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")) as { sender?: { login?: string } } : {};
    const login = event.sender?.login;
    const permission = login ? (ghApi(`repos/${repo}/collaborators/${encodeURIComponent(login)}/permission`) as { permission?: string }).permission : undefined;
    if (!canFix(permission)) throw new Error(`::error::Only people with write access to this repository can start a Proofed fix. Sender: ${login ?? "unknown"}; permission: ${permission ?? "unknown"}.`);
    const result = { stdout: JSON.stringify(ghApi(`repos/${repo}/pulls/${process.env.PROOFED_NUMBER}`)) };
    const refs = fixRefs(JSON.parse(result.stdout) as Branches);
    if (!refs) throw new Error("::error::Proofed can only fix pull requests from branches in this repository.");
    output(refs);
  } catch (e) { actionError(e); }
}
