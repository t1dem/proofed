import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
