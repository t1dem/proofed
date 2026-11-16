import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const launcher = new URL("../bin/proofed.cjs", import.meta.url).pathname;

test("the checkout launcher runs the CLI version and help", () => {
  const version = spawnSync(process.execPath, [launcher, "--version"], { encoding: "utf8" });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout, "0.1.0\n");
  const help = spawnSync(process.execPath, [launcher, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.ok(help.stdout.includes("curl -fsSL https://raw.githubusercontent.com/t1dem/proofed/main/install.sh | sh"));
});

test("old Node is rejected before the launcher or prepare loads TypeScript", () => {
  for (const path of [launcher, new URL("../scripts/prepare.cjs", import.meta.url).pathname]) {
    const ran = spawnSync(process.execPath, ["-e", `Object.defineProperty(process.versions, "node", { value: "22.0.0" }); require(process.argv[1]);`, path], { encoding: "utf8" });
    assert.equal(ran.status, 3);
    assert.match(ran.stderr, /Node 24 or newer is required \(found 22\.0\.0\)/);
    assert.match(ran.stderr, /Install Node 24\+/);
    assert.doesNotMatch(ran.stderr, /ERR_UNSUPPORTED|SyntaxError/);
  }
});
