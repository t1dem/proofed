import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { changedFiles } from "./pipeline.ts";

function inRepo(check: (git: (...args: string[]) => void) => void) {
  const cwd = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "proofed-pipeline-"));
  const git = (...args: string[]) => { execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, stdio: "ignore" }); };
  try {
    git("init", "-q", "-b", "main");
    git("config", "core.quotepath", "true");
    git("config", "diff.renames", "true");
    process.chdir(dir);
    check(git);
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a PR rename reports both the old and new paths", () => inRepo((git) => {
  writeFileSync("old.ts", "export const value = 1;\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  git("checkout", "-qb", "feature");
  renameSync("old.ts", "new.ts");
  git("add", "-A");
  git("commit", "-qm", "rename");
  assert.deepEqual(changedFiles("main").sort(), ["new.ts", "old.ts"]);
  assert.deepEqual(changedFiles("main", "feature").sort(), ["new.ts", "old.ts"]);
}));

test("PR changes preserve non-ASCII names and embedded newlines", () => inRepo((git) => {
  writeFileSync("café.ts", "1");
  writeFileSync("two\nlines.ts", "1");
  git("add", "-A");
  git("commit", "-qm", "base");
  git("checkout", "-qb", "feature");
  assert.deepEqual(changedFiles("main"), []);
  writeFileSync("café.ts", "2");
  writeFileSync("two\nlines.ts", "2");
  git("add", "-A");
  git("commit", "-qm", "change");
  assert.deepEqual(changedFiles("main"), ["café.ts", "two\nlines.ts"]);
}));
