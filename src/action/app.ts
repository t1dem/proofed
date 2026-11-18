import { spawn } from "node:child_process";
import { closeSync, openSync, writeFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { findGitBash } from "../process.ts";
import { timedAsync } from "../timing.ts";
import { actionError, capture, quiet, run, runBash, runnerFile } from "./command.ts";

const bash = () => findGitBash();
const stage = (name: string) => writeFileSync(runnerFile("proofed-stage"), `${name}\n`);

// Keep Bash's pipefail and tee's merged live output for the blocked report.
async function appCommand(command: string, record: boolean) {
  if (!record) return run(bash(), ["-e", "-o", "pipefail", "-c", command], {}, "App command");
  const script = 'bash -e -o pipefail -c "$1" 2>&1 | tee "$2"';
  await run(bash(), ["-e", "-o", "pipefail", "-c", script, "proofed", command, runnerFile("proofed-app.log")], {}, "App command");
}

async function serve(command: string) {
  const fd = openSync(runnerFile("proofed-app.log"), "w");
  try {
    const child = spawn(bash(), ["-c", command], { detached: true, stdio: ["ignore", fd, fd], windowsHide: true });
    child.once("error", () => {});
    child.unref();
  } finally { closeSync(fd); }
  await runBash("npx", ["--yes", "wait-on@8", "-t", "60000", process.env.PROOFED_URL ?? ""]);
}

export function appPort(url: string) {
  const parsed = new URL(url);
  return parsed.port || (parsed.protocol === "https:" ? "443" : "80");
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
      const pids = capture("lsof", ["-ti", `tcp:${port}`])?.split(/\s+/) ?? [];
      for (const pid of pids) {
        if (!/^[1-9]\d*$/.test(pid)) continue;
        try { process.kill(Number(pid)); } catch { /* Already stopped. */ }
      }
    }
  }
  for (let i = 0; i < 20; i++) {
    const answering = await runBash("curl", ["-s", "-o", "/dev/null", url], { stdio: quiet }).then(() => true, () => false);
    if (!answering) break;
    await setTimeout(500);
  }
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
