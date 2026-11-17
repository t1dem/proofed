import { execFileSync } from "node:child_process";
import { openSync, readSync, closeSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { findOnPath } from "./which.ts";

export function treeKillCommand(pid: number, platform = process.platform) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid child pid");
  return platform === "win32" ? { file: "taskkill", args: ["/PID", String(pid), "/T", "/F"] } : undefined;
}

// POSIX children own a process group. Windows needs taskkill to include descendants;
// a negative PID is invalid there. Keep this synchronous for exit-time cleanup too.
export function killTree(pid: number | undefined, signal: NodeJS.Signals = "SIGTERM", platform = process.platform) {
  if (!pid) return;
  try {
    const command = treeKillCommand(pid, platform);
    if (command) execFileSync(command.file, command.args, { stdio: "ignore", windowsHide: true, timeout: 10_000 });
    else process.kill(-pid, signal);
  } catch { /* Already gone. */ }
}

function nodeScript(file: string) {
  if (/\.(?:[cm]?js|ts)$/i.test(file)) return true;
  try {
    const fd = openSync(file, "r");
    try {
      const head = Buffer.alloc(150);
      const size = readSync(fd, head, 0, head.length, 0);
      return /^#![^\r\n]*\bnode(?:\.exe)?(?:\s|$)/.test(head.toString("utf8", 0, size));
    } finally { closeSync(fd); }
  } catch { return false; }
}

// Never pass CLI arguments through cmd.exe: objectives/prompts may contain quotes,
// %, &, or newlines. npm's Windows shims name the actual Node entry beside the shim.
export function executableCommand(bin: string, args: string[], env = process.env, platform = process.platform) {
  let file = findOnPath(bin, env, platform) ?? bin;
  if (platform === "win32" && /\.(?:cmd|bat)$/i.test(file)) {
    const shim = readFileSync(file, "utf8");
    const entry = /"%dp0%[\\/]([^"\r\n]+\.(?:[cm]?js|ts))"\s+%\*/i.exec(shim)?.[1];
    const script = entry && resolve(dirname(file), entry.replaceAll("\\", "/"));
    if (!script || !existsSync(script)) throw new Error(`Cannot resolve Node entry for ${file}; point KANE_CLI at its JavaScript launcher or an .exe`);
    file = script;
  }
  return nodeScript(file) ? { file: process.execPath, args: [file, ...args] } : { file, args };
}

// Prefer Git Bash over the optional WSL bash.exe in System32 on Windows runners.
export function findGitBash(env = process.env, platform = process.platform) {
  if (platform !== "win32") return "bash";
  const git = findOnPath("git", env, platform);
  const roots = [env.ProgramFiles && resolve(env.ProgramFiles, "Git"), git && resolve(dirname(git), "..")];
  return roots.filter((root): root is string => !!root)
    .flatMap((root) => [resolve(root, "bin/bash.exe"), resolve(root, "usr/bin/bash.exe")])
    .find((file) => existsSync(file)) ?? "bash";
}
