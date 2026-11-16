// The app under test on this machine: used as it is when its URL already answers, otherwise built
// and served for the check, then stopped. The commands run in a process group of their own, so
// stopping the server also stops what it started (pnpm → vite), on Ctrl-C too.
import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { adopt } from "./children.ts";
import { depsMissing, installCommand, stampInstall } from "./deps.ts";
import { SetupError } from "./setuperror.ts";
import type { Setting } from "./target.ts";

// Any HTTP answer below 500 means a server is there; a proxy in front of nothing gives 502.
export async function answers(url: string, timeout = 2000) {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeout) });
    await res.body?.cancel();
    return res.status < 500;
  } catch {
    return false;
  }
}

export function tail(file: string, lines = 20) {
  try {
    return readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

function start(command: string, cwd: string, logFile: string) {
  const fd = openSync(logFile, "a");
  writeSync(fd, `$ ${command}\n`);
  const proc = spawn(command, { cwd, shell: true, detached: true, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  const exited = new Promise<number | null>((resolve) => {
    proc.once("exit", (code, signal) => resolve(code ?? (signal ? 128 : null)));
    proc.once("error", () => resolve(127));
  });
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (proc.pid) process.kill(-proc.pid, signal);
    } catch {
      // Already gone.
    }
  };
  const release = adopt({ kill, exited });
  void exited.then(release);
  return { proc, exited, kill, release };
}

type AppOptions = {
  url: string;
  serve: string;
  build?: string;
  // Runs first, when the dependencies are missing or out of date (deps.ts).
  install?: Setting;
  cwd: string;
  logFile: string;
  timeoutSeconds: number;
  onPhase?: (line: string) => void;
};

export type RunningApp = { pid: number | undefined; stop: () => Promise<void> };

export async function startApp(o: AppOptions): Promise<RunningApp> {
  const missing = depsMissing(o.cwd);
  if (missing) {
    const install = installCommand(o.cwd, o.install);
    o.onPhase?.(`Installing dependencies (${missing}): ${install.value}`);
    const code = await start(install.value, o.cwd, o.logFile).exited;
    if (code !== 0) {
      throw new SetupError(
        "install_failed",
        `The install command exited with code ${code}: ${install.value} (from ${install.from}, in ${o.cwd})\n${tail(o.logFile)}`,
        `Make it install, or set the command with --install "<command>". Full output: ${o.logFile}`,
      );
    }
    stampInstall(o.cwd);
  }
  if (o.build) {
    o.onPhase?.(`Building the app: ${o.build}`);
    const build = start(o.build, o.cwd, o.logFile);
    const code = await build.exited;
    if (code !== 0) {
      throw new SetupError("build_failed", `The build command exited with code ${code}: ${o.build}\n${tail(o.logFile)}`, `Make the build pass, or set another one with --build "<command>". Full output: ${o.logFile}`);
    }
  }
  o.onPhase?.(`Starting the app: ${o.serve}`);
  const server = start(o.serve, o.cwd, o.logFile);
  let exitCode: number | null | undefined;
  void server.exited.then((code) => (exitCode = code));
  const stop = async () => {
    server.kill("SIGTERM");
    await Promise.race([server.exited, new Promise((r) => setTimeout(r, 3000))]);
    // A child can stay behind its exited leader; the group goes as a whole.
    server.kill("SIGKILL");
    server.release();
  };
  const deadline = Date.now() + o.timeoutSeconds * 1000;
  while (!(await answers(o.url, 1000))) {
    if (exitCode !== undefined) {
      await stop();
      throw new SetupError("serve_failed", `The serve command exited with code ${exitCode} before ${o.url} answered: ${o.serve}\n${tail(o.logFile)}`, `Make the serve command start the app, or set another one with --serve "<command>". Full output: ${o.logFile}`);
    }
    if (Date.now() > deadline) {
      await stop();
      throw new SetupError("app_not_reachable", `${o.url} didn't answer within ${o.timeoutSeconds} s of: ${o.serve}\n${tail(o.logFile)}`, `Check that the serve command listens on ${o.url}, or allow longer with --serve-timeout 120. Full output: ${o.logFile}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return { pid: server.proc.pid, stop };
}
