import assert from "node:assert/strict";
import { test } from "node:test";
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

test("raw app logs cannot copy the job token into the PR comment", () => {
  const before = process.env.GITHUB_TOKEN;
  const token = "proofed-test-secret-not-a-real-token";
  process.env.GITHUB_TOKEN = token;
  try {
    const body = blockedReport({ stage:"build", command:"pnpm build", dir:".", url:"http://localhost:5400", log:`Build failed: ${token} ${Buffer.from(`x-access-token:${token}`).toString("base64")}`, sha:"abc123" });
    assert.ok(!body.includes(token));
    assert.ok(body.includes("Build failed: ***"));
  } finally {
    if (before === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = before;
  }
});
