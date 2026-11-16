import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type Packed = {
  filename: string;
  size: number;
  unpackedSize: number;
  files: { path: string; size: number; mode: number }[];
};

export function checkContents(packed: Packed, modules: string[]) {
  assert.ok(modules.includes("proofed.js"), "dist/proofed.js is missing");
  assert.ok(modules.every((file) => /^[\w-]+\.js$/.test(file) && !file.includes(".test.")), "dist must contain only runtime JavaScript");
  // npm includes a license automatically once the owner chooses one.
  const licenses = packed.files.filter((file) => /^licen[cs]e(?:\.(?:md|txt))?$/i.test(file.path)).map((file) => file.path);
  const expected = [...licenses, "README.md", "package.json", "bin/proofed.cjs", "bin/node-version.cjs", ...modules.map((file) => `dist/${file}`)].sort();
  assert.deepEqual(packed.files.map((file) => file.path).sort(), expected, "unexpected or missing package files");
  assert.ok(packed.size > 0 && packed.size < 128 * 1024, `tarball is ${packed.size} bytes; expected under 128 KiB`);
  assert.ok(packed.unpackedSize > 0 && packed.unpackedSize < 1024 * 1024, "unpacked package must be under 1 MiB");
  assert.ok(packed.files.find((file) => file.path === "bin/proofed.cjs")!.mode & 0o111, "launcher must be executable");
}

export function checkPackage() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const temp = mkdtempSync(join(tmpdir(), "proofed-package-"));
  const prefix = join(temp, "prefix");
  const env = {
    PATH: process.env.PATH,
    HOME: join(temp, "home"),
    TMPDIR: temp,
    XDG_CONFIG_HOME: join(temp, "config"),
    XDG_CACHE_HOME: join(temp, "cache"),
    NPM_CONFIG_USERCONFIG: join(temp, "npmrc"),
    NPM_CONFIG_GLOBALCONFIG: join(temp, "global-npmrc"),
    NPM_CONFIG_CACHE: join(temp, "npm-cache"),
    NPM_CONFIG_PREFIX: prefix,
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
  };
  const run = (bin: string, args: string[], cwd = root) => execFileSync(bin, args, { cwd, env, encoding: "utf8", timeout: 120_000 });
  try {
    mkdirSync(env.HOME, { recursive: true });
    const [packed] = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", temp])) as Packed[];
    assert.ok(packed, "npm pack returned no tarball");
    checkContents(packed, readdirSync(join(root, "dist")));
    run("npm", ["install", "--global", "--ignore-scripts", "--prefix", prefix, join(temp, packed.filename)], temp);
    const launcher = join(prefix, "lib/node_modules/proofed-cli/bin/proofed.cjs");
    const manifest = JSON.parse(readFileSync(join(prefix, "lib/node_modules/proofed-cli/package.json"), "utf8")) as { version: string; scripts: Record<string, string>; dependencies?: object };
    assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0, "runtime dependencies are not expected");
    for (const hook of ["preinstall", "install", "postinstall", "prepare"]) assert.equal(manifest.scripts[hook], undefined, `consumer hook: ${hook}`);
    assert.equal(run(process.execPath, [launcher, "--version"], temp), `${manifest.version}\n`);
    assert.match(run(process.execPath, [launcher, "--help"], temp), /npm install -g proofed-cli/);
    // Use the installed link too, so a broken bin mapping cannot pass the check.
    assert.equal(run(join(prefix, "bin/proofed"), ["--version"], temp), `${manifest.version}\n`);
    console.log(`Package OK: ${packed.filename}, ${packed.files.length} files, ${packed.size} bytes packed, ${packed.unpackedSize} bytes unpacked.`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) checkPackage();
