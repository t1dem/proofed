// The app's dependencies, before Proofed builds and serves it: a fresh clone has none, and its build
// fails on the first import. They are installed only when node_modules is missing or older than
// package.json or the lockfile, never on every check: `npm ci` would wipe a working node_modules.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { Setting } from "./target.ts";

const LOCKS: [file: string, install: string][] = [
  ["pnpm-lock.yaml", "pnpm install"],
  ["bun.lock", "bun install"],
  ["bun.lockb", "bun install"],
  ["yarn.lock", "yarn install"],
  ["package-lock.json", "npm install"],
  ["npm-shrinkwrap.json", "npm install"],
];
// What a manager writes when it installs. pnpm leaves .modules.yaml alone on an install that changes
// nothing, so Proofed stamps its own installs too.
const STAMP = ".proofed-installed";
const MARKERS = [STAMP, ".modules.yaml", ".package-lock.json", ".yarn-state.yml", ".yarn-integrity"];

const mtime = (file: string) => {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
};

// The app's folder, then the folders above it up to the repository root: a workspace keeps its
// lockfile, and pnpm its install state, at the root.
function upward(dir: string) {
  const dirs: string[] = [];
  for (let d = resolve(dir); ; d = dirname(d)) {
    dirs.push(d);
    if (existsSync(join(d, ".git")) || dirname(d) === d) return dirs;
  }
}

function lockOf(dir: string) {
  for (const d of upward(dir)) {
    for (const [file, install] of LOCKS) if (existsSync(join(d, file))) return { file: join(d, file), dir: d, install };
  }
  return undefined;
}

function managerOf(dir: string) {
  try {
    const name = /^(npm|pnpm|yarn|bun)@/.exec((JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { packageManager?: unknown }).packageManager as string)?.[1];
    return name && `${name} install`;
  } catch {
    return undefined;
  }
}

// Why the dependencies need installing, or undefined when they don't (or it can't be told, as for
// an app without package.json).
export function depsMissing(dir: string): string | undefined {
  const manifest = mtime(join(dir, "package.json"));
  if (manifest === undefined) return undefined;
  if (!existsSync(join(dir, "node_modules"))) return "node_modules is missing";
  const lock = lockOf(dir);
  const homes = [...new Set([dir, lock?.dir ?? dir].map((d) => join(d, "node_modules")))];
  const times = homes.flatMap((h) => MARKERS.map((m) => mtime(join(h, m)))).filter((t) => t !== undefined);
  if (!times.length) return undefined;
  const installed = Math.max(...times);
  if (lock && (mtime(lock.file) ?? 0) > installed) return `${basename(lock.file)} changed since the last install`;
  if (manifest > installed) return "package.json changed since the last install";
  return undefined;
}

export function stampInstall(dir: string) {
  try {
    writeFileSync(join(dir, "node_modules", STAMP), `${new Date().toISOString()}\n`);
  } catch {
    // No node_modules after all (an install that put them elsewhere): the next check asks again.
  }
}

// The command that installs them: the one configured, else the app's package manager.
export function installCommand(dir: string, configured: Setting | undefined): Setting {
  if (configured) return configured;
  const declared = managerOf(dir);
  if (declared) return { value: declared, from: "packageManager in package.json" };
  const lock = lockOf(dir);
  return lock ? { value: lock.install, from: basename(lock.file) } : { value: "npm install", from: "package.json" };
}
