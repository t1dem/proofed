import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { checkContents, checkPackage, type Packed } from "../scripts/check-package.ts";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
const launcher = fileURLToPath(new URL("../bin/proofed.cjs", import.meta.url));
const launcherVersion = fileURLToPath(new URL("../bin/node-version.cjs", import.meta.url));
const require = createRequire(import.meta.url);

test("the checkout launcher runs the CLI version and help", () => {
  const version = spawnSync(process.execPath, [launcher, "--version"], { encoding: "utf8" });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout, `${pkg.version}\n`);
  const help = spawnSync(process.execPath, [launcher, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  for (const command of ["npm install -g", "pnpm add -g", "bun add -g", "npx", "pnpm dlx", "bunx"]) assert.ok(help.stdout.includes(`${command} proofed-cli`));
});

test("old Node is rejected before the launcher loads TypeScript", () => {
  const ran = spawnSync(process.execPath, ["-e", `Object.defineProperty(process.versions, "node", { value: "22.0.0" }); require(process.argv[1]);`, launcher], { encoding: "utf8" });
  assert.equal(ran.status, 3);
  assert.match(ran.stderr, /Node 22\.18 or newer is required \(found 22\.0\.0\)/);
  assert.match(ran.stderr, /Install Node 22 or newer/);
  assert.doesNotMatch(ran.stderr, /ERR_UNSUPPORTED|SyntaxError/);
});

test("the Node gate takes 22.18 and later, and nothing older", () => {
  const { supported } = require(launcherVersion) as { supported: (v: string) => boolean };
  assert.deepEqual(["20.19.0", "22.0.0", "22.17.1", "22.18.0", "22.22.3", "24.0.0", "26.7.0"].map(supported), [false, false, false, true, true, true, true]);
});

test("Bun cannot bypass the Node requirement with its compatibility version", () => {
  const ran = spawnSync(process.execPath, ["-e", `Object.defineProperty(process.versions, "bun", { value: "1.3.14" }); require(process.argv[1]);`, launcher], { encoding: "utf8" });
  assert.equal(ran.status, 3);
  assert.match(ran.stderr, /Install Node 22 or newer/);
  assert.match(ran.stderr, /put node on PATH/);
  assert.match(ran.stderr, /without --bun/);
});

test("the launcher uses source over a stale build, and dist when installed", () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-launcher-"));
  const run = () => spawnSync(process.execPath, [join(dir, "bin/proofed.cjs")], { encoding: "utf8" });
  try {
    cpSync(new URL("../bin/", import.meta.url), join(dir, "bin"), { recursive: true });
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
    writeFileSync(join(dir, "src/proofed.ts"), 'const source: string = "source"; console.log(source);\n');
    writeFileSync(join(dir, "dist/proofed.js"), 'console.log("stale");\n');
    assert.equal(run().stdout, "source\n");
    rmSync(join(dir, "src/proofed.ts"));
    assert.equal(run().status, 3, "an incomplete checkout must not fall back to dist");
    rmSync(join(dir, "src"), { recursive: true });
    assert.equal(run().stdout, "stale\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the package file check rejects source, tests, extra files, missing entries and oversized archives", () => {
  const modules = ["proofed.js", "check/help.js"];
  const files = ["README.md", "package.json", "bin/proofed.cjs", "bin/node-version.cjs", ...modules.map((file) => `dist/${file}`)].map((path) => ({ path, size: 100, mode: 0o755 }));
  const packed: Packed = { filename: "proofed-cli-0.1.0.tgz", size: 200, unpackedSize: 600, files };
  checkContents(packed, modules);
  checkContents({ ...packed, files: [...files, { path: "LICENSE", size: 100, mode: 0o644 }] }, modules);
  for (const path of ["src/proofed.ts", "dist/install.test.js", "dist/testing/fake-kane.js", "site/index.html", "action.yml"]) {
    assert.throws(() => checkContents({ ...packed, files: [...files, { path, size: 1, mode: 0o644 }] }, modules));
  }
  assert.throws(() => checkContents({ ...packed, files: files.slice(1) }, modules));
  assert.throws(() => checkContents({ ...packed, size: 128 * 1024 }, modules));
  assert.throws(() => checkContents({ ...packed, unpackedSize: 1024 * 1024 }, modules));
  assert.throws(() => checkContents(packed, [...modules, "check/install.test.js"]));
});

test("the packed CLI installs and runs without consumer scripts", { timeout: 120_000, skip: process.platform === "win32" ? "scripts/check-package.ts assumes POSIX npm/global-bin paths; source and dist launchers are tested above" : false }, () => {
  checkPackage();
});
