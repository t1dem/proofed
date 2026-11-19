import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { blockedReport } from "./blocked.ts";
import { outcomeOf, readReportData } from "../report/report.ts";

test("a serve that never answers names the command, the folder and the address", () => {
  const body = blockedReport({ stage: "serve", command: "pnpm preview --port 4173", dir: "site", url: "http://localhost:4173", log: "\u001b[31mENOENT dist\u001b[0m\n", sha: "2222222bbbb" });
  assert.match(body, /^<!-- proofed -->\n### Proofed\n\nProofed couldn't finish this check: `pnpm preview --port 4173` in `site\/` didn't answer at http:\/\/localhost:4173/);
  assert.match(body, /```\nENOENT dist\n```/);
});

test("a blocked report carries the run history on and leaves nothing to fix", () => {
  const previous = { sha: "1111111aaaa", failures: [], history: [{ sha: "1111111aaaa", state: "failed" as const }] };
  const data = readReportData(blockedReport({ stage: "build", command: "pnpm build", dir: ".", url: "http://localhost:4173", log: "", sha: "2222222bbbb", previous }));
  assert.deepEqual(data, { sha: "2222222bbbb", failures: [], history: [{ sha: "1111111aaaa", state: "failed" }, { sha: "2222222bbbb", state: "error" }] });
  assert.deepEqual(outcomeOf(data!), { state: "blocked", open: [] });
});

test("a native build can report failure with no web URL", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-blocked-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "proofed-stage"), "build\n");
  const run = spawnSync(process.execPath, [fileURLToPath(new URL("./blocked.ts", import.meta.url))], {
    encoding: "utf8",
    env: { ...process.env, RUNNER_TEMP: dir, PROOFED_TARGET: "android", PROOFED_URL: "", PROOFED_NUMBER: "1", PROOFED_SHA: "abc123", GITHUB_TOKEN: "" },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(outcomeOf(readReportData(run.stdout)!).state, "blocked");
});

test("raw app logs cannot copy the job token into the PR comment", () => {
  const before = process.env.GITHUB_TOKEN;
  const token = "proofed-test-secret-not-a-real-token";
  const encoded = Buffer.from(`x-access-token:${token}`).toString("base64");
  process.env.GITHUB_TOKEN = token;
  try {
    const body = blockedReport({ stage:"build", command:"pnpm build", dir:".", url:"http://localhost:5400", log:`Build failed: ${token} ${encoded}`, sha:"abc123" });
    assert.ok(!body.includes(token));
    assert.ok(!body.includes(encoded));
    assert.ok(body.includes("Build failed: ***"));
  } finally {
    if (before === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = before;
  }
});
