import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { env } from "../env.ts";
import { killTree } from "../process.ts";
import { maskSecrets } from "../secrets.ts";
import { actionError, CommandFailure, output, runnerFile } from "./command.ts";
import { hasCodex, installCodex } from "./tools.ts";

type Done = { code: number; installed: boolean; seconds: number };
const statusFile = (dir: string) => join(dir, "done.json");
const logFile = (dir: string) => join(dir, "install.log");
const pidFile = (dir: string) => join(dir, "pid");

function result(dir: string): Done | undefined {
  return existsSync(statusFile(dir)) ? JSON.parse(readFileSync(statusFile(dir), "utf8")) as Done : undefined;
}

async function worker(dir: string) {
  const start = performance.now();
  let code = 0;
  let installed = false;
  try { installed = await installCodex(env("PROOFED_CODEX_DIR")); }
  catch (e) {
    if (!(e instanceof CommandFailure)) actionError(e);
    code = e instanceof CommandFailure ? e.exitCode : 1;
  }
  const done: Done = { code, installed, seconds: (performance.now() - start) / 1000 };
  const pending = join(dir, "done.tmp");
  writeFileSync(pending, JSON.stringify(done));
  renameSync(pending, statusFile(dir));
}

export async function startCodex(prefix: string) {
  if (hasCodex(prefix)) return;
  const dir = mkdtempSync(runnerFile("proofed-codex-install-"));
  try {
    const fd = openSync(logFile(dir), "w", 0o600);
    const child = (() => {
      try {
        return spawn(process.execPath, [fileURLToPath(import.meta.url), "worker", dir], {
          detached: true, stdio: ["ignore", fd, fd], windowsHide: true,
        });
      } finally { closeSync(fd); }
    })();
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      writeFileSync(pidFile(dir), String(child.pid));
      output({ dir });
    } catch (e) {
      killTree(child.pid);
      throw e;
    } finally { child.unref(); }
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    // The foreground fixer can still install Codex if the background worker couldn't start.
    console.log("Couldn't start preparing Codex in the background.");
  }
}

function running(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

export async function waitForCodex(dir: string) {
  const pid = Number(readFileSync(pidFile(dir), "utf8"));
  while (true) {
    const done = result(dir);
    if (done) {
      const log = maskSecrets(readFileSync(logFile(dir), "utf8"));
      if (log) process.stderr.write(log);
      if (done.code) throw new CommandFailure("npm", done.code);
      return;
    }
    if (!running(pid)) {
      // Check the atomically written status again after observing process exit.
      if (result(dir)) continue;
      throw new Error("The background Codex install exited without a result.");
    }
    await setTimeout(250);
  }
}

export function collectCodex(dir: string) {
  const done = result(dir);
  if (done) {
    console.log(`Proofed timing tool install (Codex background): ${done.seconds.toFixed(2)}s`);
    output({ installed: !done.code && done.installed });
  }
}

export function removeBackground(dir: string) {
  if (!existsSync(dir)) return;
  if (!result(dir) && existsSync(pidFile(dir))) killTree(Number(readFileSync(pidFile(dir), "utf8")), "SIGKILL");
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

if (import.meta.main) {
  try {
    if (process.argv[2] === "worker" && process.argv[3]) await worker(process.argv[3]);
    else throw new Error("Unknown background install command.");
  } catch (e) { actionError(e); }
}
