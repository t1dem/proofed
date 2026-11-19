import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runKane } from "./kane.ts";

test("cancelling Kane kills a process that ignores SIGTERM before the wall timeout", { skip: process.platform === "win32" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-kane-cancel-"));
  const oldBin = process.env.KANE_CLI;
  const oldTmp = process.env.TMPDIR;
  const bin = join(dir, "kane");
  try {
    writeFileSync(bin, `#!${process.execPath}
if (process.argv[2] === "balance") process.exit(1);
process.on("SIGTERM", () => {});
console.log(JSON.stringify({ step: 1, status: "running", remark: "assert: waiting", ts: "" }));
setInterval(() => {}, 1000);
`, { mode: 0o755 });
    process.env.KANE_CLI = bin;
    process.env.TMPDIR = dir;
    const controller = new AbortController();
    const result = await runKane({
      objective: "assert",
      kaneArgs: [],
      signal: controller.signal,
      wallTimeoutSeconds: 12,
      onStep: () => controller.abort(),
    });
    assert.ok(controller.signal.aborted);
    assert.equal(result.timedOut, false);
    assert.equal(result.exitCode, null);
  } finally {
    if (oldBin === undefined) delete process.env.KANE_CLI;
    else process.env.KANE_CLI = oldBin;
    if (oldTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = oldTmp;
    rmSync(dir, { recursive: true, force: true });
  }
});
