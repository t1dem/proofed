import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { kaneLogin } from "./kaneauth.ts";

test("a successful Kane login probe preserves the balance output", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-kaneauth-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "balance.cjs");
  writeFileSync(bin, 'console.log("Available credits: 6104.8734");');
  const result = await kaneLogin(bin, process.env);
  assert.match(result.balance ?? "", /^Available credits: 6104\.8734$/m);
});

test("the balance deadline settles when Kane ignores SIGTERM and a child holds the pipes", { skip: process.platform === "win32", timeout: 6000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-kaneauth-"));
  const bin = join(dir, "balance.cjs");
  const pidFile = join(dir, "pids.json");
  t.after(() => {
    if (existsSync(pidFile)) {
      const pids = JSON.parse(readFileSync(pidFile, "utf8")) as number[];
      for (const pid of pids) {
        try { process.kill(pid, "SIGKILL"); } catch { /* Already exited. */ }
      }
    }
    rmSync(dir, { recursive: true, force: true });
  });
  writeFileSync(bin, `
const { spawn } = require("node:child_process");
process.on("SIGTERM", () => {});
const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], { stdio: "inherit" });
require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify([process.pid, child.pid]));
console.log("Available credits: 6104.8734");
`);
  const started = Date.now();
  const result = await kaneLogin(bin, process.env, 500);
  assert.ok(existsSync(pidFile), "the probe started the process holding its pipes");
  assert.equal(result.state, "unknown");
  assert.match(result.detail, /didn't answer within/);
  assert.equal(result.balance, undefined);
  assert.ok(Date.now() - started < 4000, "the probe settled before the subprocess exited");
});
