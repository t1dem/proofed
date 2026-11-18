import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { changedFiles } from "./changes.ts";
import { live } from "./live.ts";
import { publish, runAll } from "./pipeline.ts";
import type { RunFile } from "./runfile.ts";
import { loadScenariosOr, pickScenarios } from "./scenarios.ts";
import { resolveScenarioTarget } from "./target.ts";

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

test("invalid concurrency cannot leave a batch of scenarios unchecked", async () => {
  for (const concurrency of [-1, 0, 0.5, Infinity]) {
    await assert.rejects(runAll([], ".", concurrency), /concurrency.*whole number/i);
  }
  const before = process.env.PROOFED_CONCURRENCY;
  try {
    process.env.PROOFED_CONCURRENCY = "-1";
    await assert.rejects(runAll([], "."), /PROOFED_CONCURRENCY.*whole number/);
  } finally {
    if (before === undefined) delete process.env.PROOFED_CONCURRENCY;
    else process.env.PROOFED_CONCURRENCY = before;
  }
});

test("a mobile check publishes its running state and Kane steps", { skip: process.platform === "win32" }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-mobile-live-"));
  const kane = join(dir, "kane");
  const before = process.env.KANE_CLI;
  t.after(() => {
    if (before === undefined) delete process.env.KANE_CLI;
    else process.env.KANE_CLI = before;
    rmSync(dir, { recursive: true, force: true });
  });
  writeFileSync(kane, `#!${process.execPath}
console.log(JSON.stringify({ step: 1, status: "done", remark: "assert: counter is 1", ts: new Date().toISOString() }));
console.log(JSON.stringify({ type: "run_end", status: "passed" }));
`, { mode: 0o755 });
  process.env.KANE_CLI = kane;
  const sent: string[] = [];
  t.mock.method(live, "scenario", (id: string, patch: Parameters<typeof live.scenario>[1]) => sent.push(`${id}:${patch.status}`));
  t.mock.method(live, "step", (id: string, step: Parameters<typeof live.step>[1]) => sent.push(`${id}:${step.remark}`));
  const target = resolveScenarioTarget({ target: "ios", execution: "cloud", app: "APP123" }, {}, {}, dir);
  const [result] = await runAll([{ id: "counter", name: "Counter", file: "", paths: [], url: "", objective: "Assert counter is 1.", resolvedTarget: target }], dir, 1, { noRetry: true });
  assert.equal(result?.outcome, "passed");
  assert.deepEqual(sent, ["counter:running", "counter:assert: counter is 1", "counter:passed"]);
});

test("an explicit scenario selection rejects missing IDs", () => inRepo(() => {
  assert.throws(() => pickScenarios({ only: ["typo"] }), /No scenario typo/);
}));

test("base scenarios keep special filenames and surface invalid files", () => inRepo((git) => {
  mkdirSync(".proofed/scenarios", { recursive: true });
  const file = ".proofed/scenarios/café.md";
  writeFileSync(file, "---\nname: Fallback\n---\nCheck the page.\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  rmSync(".proofed", { recursive: true });
  assert.deepEqual(loadScenariosOr(".proofed/scenarios", "HEAD").map((s) => s.file), [file]);
  assert.deepEqual(loadScenariosOr(".proofed/scenarios/", "HEAD").map((s) => s.file), [file]);

  mkdirSync(".proofed/scenarios", { recursive: true });
  writeFileSync(".proofed/scenarios/broken.md", "missing frontmatter");
  git("add", "-A");
  git("commit", "-qm", "invalid scenario");
  rmSync(".proofed", { recursive: true });
  assert.throws(() => loadScenariosOr(".proofed/scenarios", "HEAD"), /broken\.md: missing frontmatter/);
}));

test("the clips and their run file go into one commit at the same URLs", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-publish-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const extensions = ["gif", "mp4", "jpg"] as const;
  const clip = { gif: join(dir, "clip.gif"), mp4: join(dir, "clip.mp4"), jpg: join(dir, "clip.jpg") };
  for (const ext of extensions) writeFileSync(clip[ext], ext);

  const requests: string[] = [];
  const blobs = new Map<string, string>();
  const paths = new Map<string, string>();
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.replace("/repos/fixture/repo", "");
    requests.push(`${init.method} ${path}`);
    if (path === "/git/ref/heads/proofed-clips") return Response.json({}, { status: 404 });
    if (path === "/git/blobs") {
      const sha = String(blobs.size);
      const { content } = JSON.parse(String(init.body)) as { content: string };
      blobs.set(sha, Buffer.from(content, "base64").toString());
      return Response.json({ sha });
    }
    if (path === "/git/trees") {
      const { tree } = JSON.parse(String(init.body)) as { tree: { path: string; sha: string }[] };
      for (const entry of tree) paths.set(entry.path, blobs.get(entry.sha)!);
      return Response.json({ sha: "tree" });
    }
    if (path === "/git/commits") {
      assert.equal(JSON.parse(String(init.body)).tree, "tree");
      return Response.json({ sha: "commit" });
    }
    if (path === "/git/refs") {
      assert.deepEqual(JSON.parse(String(init.body)), { ref: "refs/heads/proofed-clips", sha: "commit" });
      return Response.json({});
    }
    if (path === "/issues/1/comments" && init.method === "GET") return Response.json([]);
    if (path === "/issues/1/comments" && init.method === "POST") return Response.json({ id: 1, html_url: "https://example.test/report" });
    if (path === "/statuses/abcdef12") return Response.json({});
    throw new Error(`Unexpected request ${path}`);
  });

  const scenario = { id: "counter", name: "Counter", file: "", paths: [], url: "/", objective: "Check the counter." };
  await publish({
    repo: { owner: "fixture", name: "repo", token: "fake-token" }, pr: 1, sha: "abcdef12",
    results: [{ scenario, outcome: "passed", steps: [], end: undefined, clip }], skipped: [], runUrl: undefined, outDir: dir,
  });

  const prefix = `pr-1/abcdef1-${process.env.GITHUB_RUN_ID ?? "local"}`;
  assert.deepEqual([...paths.keys()].sort(), ["counter.gif", "counter.jpg", "counter.mp4", "run.json"].map((file) => `${prefix}/${file}`));
  const archived = JSON.parse(paths.get(`${prefix}/run.json`)!) as RunFile;
  for (const ext of extensions) {
    const path = `${prefix}/counter.${ext}`;
    assert.equal(paths.get(path), ext);
    assert.equal(archived.scenarios[0]?.clip?.[ext], `https://github.com/fixture/repo/raw/proofed-clips/${path}`);
  }
  assert.equal(requests.filter((r) => r === "POST /git/commits").length, 1);
  assert.equal(requests.filter((r) => r === "POST /git/refs").length, 1);
});
