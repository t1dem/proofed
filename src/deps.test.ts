import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { depsMissing, installCommand, stampInstall } from "./deps.ts";

const tree = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-deps-"));
  mkdirSync(join(dir, ".git"));
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), body);
  }
  return dir;
};
const age = (file: string, seconds: number) => utimesSync(file, Date.now() / 1000 - seconds, Date.now() / 1000 - seconds);

test("dependencies are missing without node_modules, and stale when the manifest or lockfile is newer", () => {
  const dir = tree({ "package.json": "{}", "pnpm-lock.yaml": "" });
  try {
    assert.equal(depsMissing(dir), "node_modules is missing");
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules/.modules.yaml"), "");
    for (const f of ["package.json", "pnpm-lock.yaml"]) age(join(dir, f), 60);
    assert.equal(depsMissing(dir), undefined);
    age(join(dir, "node_modules/.modules.yaml"), 120);
    assert.equal(depsMissing(dir), "pnpm-lock.yaml changed since the last install");
    // pnpm leaves its state alone on an install that changes nothing; Proofed's stamp counts.
    stampInstall(dir);
    assert.equal(depsMissing(dir), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an app without package.json, or with node_modules nothing vouches for, is left alone", () => {
  const plain = tree({ "index.html": "" });
  const bun = tree({ "package.json": "{}", "bun.lock": "", "node_modules/x/index.js": "" });
  try {
    assert.equal(depsMissing(plain), undefined);
    assert.equal(depsMissing(bun), undefined);
  } finally {
    rmSync(plain, { recursive: true, force: true });
    rmSync(bun, { recursive: true, force: true });
  }
});

test("the install command: configured, else packageManager, else the lockfile, up to the repo root", () => {
  const ws = tree({ "pnpm-lock.yaml": "", "package.json": "{}", "apps/web/package.json": "{}" });
  const declared = tree({ "package.json": JSON.stringify({ packageManager: "yarn@4.5.0" }), "package-lock.json": "{}" });
  const none = tree({ "package.json": "{}" });
  try {
    assert.deepEqual(installCommand(join(ws, "apps/web"), undefined), { value: "pnpm install", from: "pnpm-lock.yaml" });
    assert.deepEqual(installCommand(join(ws, "apps/web"), { value: "pnpm install --frozen-lockfile", from: "--install" }), { value: "pnpm install --frozen-lockfile", from: "--install" });
    assert.deepEqual(installCommand(declared, undefined), { value: "yarn install", from: "packageManager in package.json" });
    assert.deepEqual(installCommand(none, undefined), { value: "npm install", from: "package.json" });
  } finally {
    for (const d of [ws, declared, none]) rmSync(d, { recursive: true, force: true });
  }
});
