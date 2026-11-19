import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { creditMeter } from "./creditmeter.ts";

test("balance snapshots are observations, and concurrent meters discard their delta", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-meter-"));
  const lock = join(dir, "lock");
  const balance = join(dir, "balance");
  const env = { ...process.env, KANE_CLI: fileURLToPath(new URL('../testing/fake-kane.ts', import.meta.url)), FAKE_KANE_BALANCE_FILE: balance };
  try {
    writeFileSync(balance, "100");
    const finish = await creditMeter(env, lock);
    writeFileSync(balance, "82");
    assert.deepEqual(await finish(), { before: 100, after: 82, debit: 18 });
    const first = await creditMeter(env, lock);
    const second = await creditMeter(env, lock);
    assert.equal(await second(), undefined);
    assert.equal(await first(), undefined);
    const owner = await creditMeter(env, lock);
    const overlapping = await creditMeter(env, lock);
    assert.equal(await owner(), undefined);
    const third = await creditMeter(env, lock);
    writeFileSync(balance, "62");
    assert.equal(await overlapping(), undefined);
    assert.equal(await third(), undefined);
    assert.deepEqual(await (await creditMeter(env, lock))(), { before: 62, after: 62, debit: 0 });
    const failed = await creditMeter({ ...env, FAKE_KANE_SIGNED_IN: "0", LT_USERNAME: "", LT_ACCESS_KEY: "" }, lock);
    assert.equal(await failed(), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test("a dead owner's lock is reclaimed and balance metering resumes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-meter-"));
  const lock = join(dir, "lock");
  const balance = join(dir, "balance");
  const env = { ...process.env, KANE_CLI: fileURLToPath(new URL("../testing/fake-kane.ts", import.meta.url)), FAKE_KANE_BALANCE_FILE: balance };
  try {
    mkdirSync(lock, { mode: 0o700 });
    mkdirSync(join(lock, `2147483647-${randomUUID()}`));
    writeFileSync(balance, "100");
    const finish = await creditMeter(env, lock);
    writeFileSync(balance, "82");
    assert.deepEqual(await finish(), { before: 100, after: 82, debit: 18 });
    assert.deepEqual(readdirSync(lock), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a non-private credit lock is left alone", { skip: process.getuid === undefined }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-meter-"));
  const lock = join(dir, "lock");
  try {
    mkdirSync(lock, { mode: 0o755 });
    assert.equal(await (await creditMeter({}, lock))(), undefined);
    assert.deepEqual(readdirSync(lock), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a lock removed mid-run loses the snapshot instead of failing the run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-meter-"));
  const lock = join(dir, "lock");
  const env = { ...process.env, KANE_CLI: fileURLToPath(new URL("../testing/fake-kane.ts", import.meta.url)) };
  try {
    const finish = await creditMeter(env, lock);
    rmSync(lock, { recursive: true, force: true });
    assert.equal(await finish(), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a replaced credit lock invalidates the old meter and survives its cleanup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-meter-"));
  const lock = join(dir, "lock");
  const env = { ...process.env, KANE_CLI: fileURLToPath(new URL("../testing/fake-kane.ts", import.meta.url)) };
  try {
    const finish = await creditMeter(env, lock);
    rmSync(lock, { recursive: true });
    const replacement = await creditMeter(env, lock);
    assert.equal(await finish(), undefined);
    assert.equal(readdirSync(lock).length, 1);
    assert.deepEqual(await replacement(), { before: 1234.5, after: 1234.5, debit: 0 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
