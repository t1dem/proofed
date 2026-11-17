import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { lockDevice } from "./preparetarget.ts";

test("a device lock keeps a second run out until it is released", () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-lock-"));
  try {
    const release = lockDevice("iPhone 16", dir);
    assert.throws(() => lockDevice("iPhone 16", dir), /in use by another Proofed run/);
    release();
    lockDevice("iPhone 16", dir)();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a lock left by a dead run, or an old directory lock, is taken over", () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-lock-"));
  try {
    const lock = join(dir, "proofed-device-emulator-5554.lock");
    const dead = spawnSync(process.execPath, ["-e", ""]).pid!;
    writeFileSync(lock, String(dead));
    const release = lockDevice("emulator-5554", dir);
    assert.equal(readFileSync(lock, "utf8"), String(process.pid));
    release();
    mkdirSync(lock);
    lockDevice("emulator-5554", dir)();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
