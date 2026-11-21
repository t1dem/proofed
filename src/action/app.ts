import { spawn } from "node:child_process";
import { closeSync, openSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { setTimeout } from "node:timers/promises";
import { findGitBash, killTree } from "../process.ts";
import { timedAsync } from "../timing.ts";
import { actionError, capture, run, runBash, runnerFile } from "./command.ts";

const bash = () => findGitBash();
const stage = (name: string) => writeFileSync(runnerFile("proofed-stage"), `${name}\n`);

// Keep Bash's pipefail and tee's merged live output for the blocked report.
async function appCommand(command: string, record: boolean) {
  if (!record) return run(bash(), ["-e", "-o", "pipefail", "-c", command], {}, "App command");
  const script = 'bash -e -o pipefail -c "$1" 2>&1 | tee "$2"';
  await run(bash(), ["-e", "-o", "pipefail", "-c", script, "proofed", command, runnerFile("proofed-app.log")], {}, "App command");
}

async function serve(command: string) {
  const url = process.env.PROOFED_URL ?? "";
  const fd = openSync(runnerFile("proofed-app.log"), "w");
  try {
    if (await portOccupied(url)) throw new Error(`The port for ${url} is already in use or could not be checked.`);
    const child = spawn(bash(), ["-c", command], { detached: true, stdio: ["ignore", fd, fd], windowsHide: true });
    const exitedEarly = () => new Error(`The serve command exited before ${url} was ready (${child.signalCode ?? `code ${child.exitCode}`}).`);
    const exited = new Promise<never>((_resolve, reject) => {
      child.once("error", reject);
      child.once("exit", () => reject(exitedEarly()));
    });
    const waiting = new AbortController();
    try {
      await Promise.race([exited, runBash("npx", ["--yes", "wait-on@8", "-t", "60000", url], {
        signal: waiting.signal, stdio: ["ignore", fd, fd],
      })]);
      if (child.exitCode !== null || child.signalCode !== null) throw exitedEarly();
    } catch (error) {
      killTree(child.pid);
      throw error;
    } finally {
      waiting.abort();
      child.unref();
    }
  } finally { closeSync(fd); }
}

export function appPort(url: string) {
  const parsed = new URL(url);
  return parsed.port || (parsed.protocol === "https:" ? "443" : "80");
}

// A refused connection to a free loopback port arrives at once, but a busy runner can delay the callback past a short timeout.
const PORT_CHECK_TIMEOUT = 2000;

function portOccupied(url: string, timeout = PORT_CHECK_TIMEOUT) {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port: Number(appPort(url)), signal: AbortSignal.timeout(timeout) });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    // Only a refused connection confirms that no server accepted it.
    socket.once("error", (error) => resolve(!("code" in error && error.code === "ECONNREFUSED")));
  });
}

export async function stopCheckServer(url: string) {
  const port = appPort(url);
  if (process.env.RUNNER_OS === "Windows") {
    await runBash("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-NetTCPConnection -LocalPort ([int]$env:PROOFED_PORT) -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { & taskkill.exe /PID $_ /T /F }",
    ], { env: { ...process.env, PROOFED_PORT: port }, stdio: "ignore" }).catch(() => {});
  } else {
    const killed = await runBash("fuser", ["-k", `${port}/tcp`], { stdio: "ignore" }).then(() => true, () => false);
    if (!killed) {
      const pids = capture("lsof", ["-a", "-ti", `tcp:${port}`, "-sTCP:LISTEN"])?.split(/\s+/) ?? [];
      for (const pid of pids) {
        if (!/^[1-9]\d*$/.test(pid)) continue;
        try { process.kill(Number(pid)); } catch { /* Already stopped. */ }
      }
    }
  }
  const deadline = Date.now() + 10_000;
  for (let remaining = deadline - Date.now(); remaining > 0; remaining = deadline - Date.now()) {
    if (!(await portOccupied(url, Math.min(PORT_CHECK_TIMEOUT, remaining)))) return;
    await setTimeout(Math.min(500, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`The check server did not release the port for ${url}.`);
}

if (import.meta.main) {
  try {
    if (process.argv[2] === "install") {
      await timedAsync("deps", async () => {
        const record = process.env.PROOFED_LEGACY_FIX !== "true";
        if (record) stage("install");
        await appCommand(process.env.PROOFED_INSTALL ?? "", record);
      });
    } else if (process.argv[2] === "build") {
      await timedAsync("build", async () => {
        stage("build");
        await appCommand(process.env.PROOFED_BUILD ?? "", true);
      });
      stage("serve");
      const command = process.env.PROOFED_SERVE;
      if (process.env.PROOFED_WEB === "true" && command) await timedAsync("app ready", () => serve(command));
    } else throw new Error("Unknown action app step.");
  } catch (e) { actionError(e); }
}
