import { spawnSync } from "node:child_process";
import type { PullRequest } from "../github.ts";
import { findGitBash } from "../process.ts";
import { actionError, bash, CommandFailure, output } from "./command.ts";

type Ref = PullRequest["head"] & { repo?: { full_name: string } | null };
type Branches = { head: Ref; base: Ref };

export function fixRefs({ head, base }: Branches) {
  if (!head.repo?.full_name || head.repo.full_name !== base.repo?.full_name) return undefined;
  return { base: base.sha, base_ref: base.ref, head_ref: head.ref };
}

if (import.meta.main) {
  try {
    const result = spawnSync(findGitBash(), bash("gh", ["api", `repos/${process.env.GITHUB_REPOSITORY}/pulls/${process.env.PROOFED_NUMBER}`]), {
      stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", windowsHide: true,
    });
    if (result.status !== 0) throw new CommandFailure("gh api", result.status ?? 1);
    const refs = fixRefs(JSON.parse(result.stdout) as Branches);
    if (!refs) throw new Error("::error::Proofed can only fix pull requests from branches in this repository.");
    output(refs);
  } catch (e) { actionError(e); }
}
