// What the local change is, for `proofed check`: every file that differs between the merge base
// with the base branch and the working tree (committed, staged or not) plus new files git doesn't
// ignore. A coding agent's edits are usually uncommitted, so the PR check's base...HEAD isn't enough.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { SetupError } from "./setuperror.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

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

// Paths relative to `cwd`, like the scenarios' `paths` and file names.
export function localChanges(cwd: string, base: string) {
  // Real paths on both sides: git reports /private/var/… for a temp folder the shell calls /var/….
  const root = realpathSync(git(cwd, "rev-parse", "--show-toplevel").trim());
  const here = realpathSync(cwd);
  const mergeBase = tries(() => git(cwd, "merge-base", base, "HEAD")) ?? base;
  const lines = (s: string) => s.split("\n").filter(Boolean);
  const files = new Set([
    ...lines(git(root, "diff", "--name-only", "--no-renames", mergeBase)),
    ...lines(git(root, "ls-files", "--others", "--exclude-standard", "--full-name")),
  ]);
  return [...files].map((f) => relative(here, join(root, f))).sort();
}
