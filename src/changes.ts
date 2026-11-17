import { gitPath } from "./paths.ts";
// What the local change is, for `proofed check`: every file that differs between the merge base
// with the base branch and the working tree (committed, staged or not) plus new files git doesn't
// ignore. A coding agent's edits are usually uncommitted, so the PR check's base...HEAD isn't enough.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { SetupError } from "./setuperror.ts";

// A repo with an unignored node_modules lists megabytes of untracked names; the default is 1 MB.
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });

const tries = (fn: () => string) => {
  try {
    return fn().trim();
  } catch {
    return undefined;
  }
};

export const BASES = ["origin/HEAD", "origin/main", "origin/master", "main", "master"];

export type Base = { rev: string; why?: undefined } | { rev?: undefined; why: string };

// The remote's default branch as origin/HEAD names it, else the usual names.
export function findBase(cwd: string, asked?: string): Base {
  if (tries(() => git(cwd, "rev-parse", "--is-inside-work-tree")) !== "true") {
    if (asked) throw new SetupError("not_a_git_repo", `--base ${asked} needs a git repository, and ${cwd} isn't one.`, "Run proofed in the app's repository, or drop --base.");
    return { why: "not a git repository" };
  }
  if (asked) {
    if (tries(() => git(cwd, "rev-parse", "--verify", "--quiet", `${asked}^{commit}`))) return { rev: asked };
    throw new SetupError("base_not_found", `--base ${asked} is not a commit or branch here.`, `Pick an existing one, e.g. --base ${defaultBase(cwd) ?? "main"}, or run git fetch first.`);
  }
  const rev = defaultBase(cwd);
  return rev ? { rev } : { why: `no base branch (tried ${BASES.join(", ")})` };
}

function defaultBase(cwd: string) {
  const head = tries(() => git(cwd, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"));
  if (head) return head;
  return BASES.slice(1).find((rev) => tries(() => git(cwd, "rev-parse", "--verify", "--quiet", `${rev}^{commit}`)));
}

// Real paths: git reports /private/var/… for a temp folder the shell calls /var/….
export function repoRoot(cwd: string) {
  const root = tries(() => git(cwd, "rev-parse", "--show-toplevel"));
  return root ? realpathSync(root) : undefined;
}

// The commit the local change is measured from. A cached pass is keyed on it too: after a pull or
// a rebase the code under a scenario's `paths` can differ without being part of the local change.
export const mergeBaseOf = (cwd: string, base: string) =>
  tries(() => git(cwd, "merge-base", base, "HEAD")) ?? tries(() => git(cwd, "rev-parse", "--verify", "--quiet", `${base}^{commit}`)) ?? base;

// Paths relative to `cwd`, like the scenarios' `paths` and file names.
export function localChanges(cwd: string, base: string) {
  const root = realpathSync(git(cwd, "rev-parse", "--show-toplevel").trim());
  const here = realpathSync(cwd);
  // -z: without it git quotes and escapes a name such as café.ts, and it matches no path.
  const names = (s: string) => s.split("\0").filter(Boolean);
  const files = new Set([
    ...names(git(root, "diff", "--name-only", "--no-renames", "-z", mergeBaseOf(cwd, base))),
    ...names(git(root, "ls-files", "--others", "--exclude-standard", "--full-name", "-z")),
  ]);
  return [...files].map((f) => gitPath(relative(here, join(root, f)))).sort();
}
