import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { lockDevice } from "./preparetarget.ts";

const options = { skip: process.platform !== "darwin" ? "Local mobile device locks require macOS" : false };

test("a device lock keeps a second run out until it is released", options, () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-lock-"));
  try {
    const release = lockDevice("iPhone 16", dir);
    assert.throws(() => lockDevice("iPhone 16", dir), /in use by another Proofed run/);
    release();
    lockDevice("iPhone 16", dir)();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a lock left by a dead run, or an old directory lock, is taken over", options, () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-lock-"));
  try {
    const lock = join(dir, "proofed-device-emulator-5554.lock");
    const module = new URL("./preparetarget.ts", import.meta.url).href;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e",
      `import { lockDevice } from ${JSON.stringify(module)}; lockDevice("emulator-5554", process.argv[1]);`, dir,
    ], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(readFileSync(lock, "utf8"), String(child.pid));
    const release = lockDevice("emulator-5554", dir);
    assert.equal(readFileSync(lock, "utf8"), String(process.pid));
    release();
    mkdirSync(lock);
    lockDevice("emulator-5554", dir)();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a stale PID marker cannot bypass an active device lock", options, () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-lock-"));
  try {
    const dead = spawnSync(process.execPath, ["-e", ""]).pid!;
    const release = lockDevice("emulator-5554", dir);
    try {
      writeFileSync(join(dir, "proofed-device-emulator-5554.lock"), String(dead));
      assert.throws(() => lockDevice("emulator-5554", dir), /in use by another Proofed run/);
    } finally { release(); }
    lockDevice("emulator-5554", dir)();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
