import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findBase, localChanges } from "./changes.ts";
import { SetupError } from "./setuperror.ts";

test("the local change: committed, staged, unstaged and new files, not ignored ones", () => {
  const cwd = mkdtempSync(join(tmpdir(), "proofed-changes-"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, stdio: "ignore" });
  try {
    git("init", "-q", "-b", "main");
    mkdirSync(join(cwd, "src"));
    for (const f of ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"]) writeFileSync(join(cwd, f), "1");
    writeFileSync(join(cwd, ".gitignore"), "dist\n");
    git("add", "-A");
    git("commit", "-qm", "base");
    assert.deepEqual(findBase(cwd), { rev: "main" });
    assert.deepEqual(localChanges(cwd, "main"), []);

    git("checkout", "-qb", "feature");
    writeFileSync(join(cwd, "src/a.ts"), "committed");
    git("commit", "-qam", "a");
    writeFileSync(join(cwd, "src/b.ts"), "staged");
    git("add", "src/b.ts");
    writeFileSync(join(cwd, "src/c.ts"), "unstaged");
    writeFileSync(join(cwd, "src/new.ts"), "new");
    mkdirSync(join(cwd, "dist"));
    writeFileSync(join(cwd, "dist/out.js"), "ignored");
    assert.deepEqual(localChanges(cwd, "main"), ["src/a.ts", "src/b.ts", "src/c.ts", "src/new.ts"]);
    // From a folder inside the repo, paths are relative to it, like the scenarios'.
    assert.deepEqual(localChanges(join(cwd, "src"), "main"), ["a.ts", "b.ts", "c.ts", "new.ts"]);

    assert.throws(() => findBase(cwd, "nope"), (e) => e instanceof SetupError && e.code === "base_not_found");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("outside a git repository there is no base, and the check says why", () => {
  const cwd = mkdtempSync(join(tmpdir(), "proofed-nogit-"));
  try {
    assert.deepEqual(findBase(cwd), { why: "not a git repository" });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
