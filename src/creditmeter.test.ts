import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { creditMeter } from "./creditmeter.ts";

test("balance snapshots are observations, and concurrent meters discard their delta", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-meter-"));
  const lock = join(dir, "lock");
  const balance = join(dir, "balance");
  const env = { ...process.env, KANE_CLI: new URL('./testing/fake-kane.ts', import.meta.url).pathname, FAKE_KANE_BALANCE_FILE: balance };
  try {
    writeFileSync(balance, "100");
    const finish = await creditMeter(env, lock);
    writeFileSync(balance, "82");
    assert.deepEqual(await finish(), { before: 100, after: 82, debit: 18 });
    const first = await creditMeter(env, lock);
    const second = await creditMeter(env, lock);
    assert.equal(await second(), undefined);
    assert.equal(await first(), undefined);
    const failed = await creditMeter({ ...env, FAKE_KANE_SIGNED_IN: "0", LT_USERNAME: "", LT_ACCESS_KEY: "" }, lock);
    assert.equal(await failed(), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test("a dead owner's lock is reclaimed and balance metering resumes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-meter-"));
  const lock = join(dir, "lock");
  const balance = join(dir, "balance");
  const env = { ...process.env, KANE_CLI: new URL("./testing/fake-kane.ts", import.meta.url).pathname, FAKE_KANE_BALANCE_FILE: balance };
  try {
    mkdirSync(lock);
    writeFileSync(join(lock, "meter"), "2147483647");
    mkdirSync(join(lock, "reclaim"));
    writeFileSync(join(lock, "reclaim", "2147483647"), "");
    writeFileSync(join(lock, "contended"), "");
    writeFileSync(balance, "100");
    const finish = await creditMeter(env, lock);
    writeFileSync(balance, "82");
    assert.deepEqual(await finish(), { before: 100, after: 82, debit: 18 });
    assert.equal(existsSync(lock), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("live owners and fresh missing pids stay contended; old unreadable pids are reclaimed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-meter-"));
  const lock = join(dir, "lock");
  const env = { ...process.env, KANE_CLI: new URL("./testing/fake-kane.ts", import.meta.url).pathname };
  try {
    mkdirSync(lock);
    writeFileSync(join(lock, "meter"), String(process.pid));
    assert.equal(await (await creditMeter(env, lock))(), undefined);
    assert.equal(existsSync(join(lock, "contended")), true);
    rmSync(lock, { recursive: true });
    mkdirSync(lock);
    assert.equal(await (await creditMeter(env, lock))(), undefined);
    assert.equal(existsSync(lock), true);
    rmSync(lock, { recursive: true });
    mkdirSync(lock);
    writeFileSync(join(lock, "meter"), "not a pid");
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);
    assert.deepEqual(await (await creditMeter(env, lock))(), { before: 1234.5, after: 1234.5, debit: 0 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test("takeover preserves a live contender's credit attribution warning", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-meter-"));
  const lock = join(dir, "lock");
  const env = { ...process.env, KANE_CLI: new URL("./testing/fake-kane.ts", import.meta.url).pathname };
  try {
    mkdirSync(lock);
    writeFileSync(join(lock, "meter"), "2147483647");
    writeFileSync(join(lock, `contended-${process.pid}`), "");
    assert.equal(await (await creditMeter(env, lock))(), undefined);
    assert.equal(existsSync(lock), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
