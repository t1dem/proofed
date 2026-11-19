import { executableCommand, killTree } from "../process.ts";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, closeSync, constants, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { adopt } from "../children.ts";
import { launchChrome } from "./chrome.ts";
import { cdpOccupied, command, isAppBundle, kaneTarget, localDevice, renderer, targetChecks } from "./targetchecks.ts";
import { startRecorder } from "./recorder.ts";
import type { Clip } from "../types.ts";
import type { Target } from "./target.ts";

function owned(bin: string, args: string[], cwd?: string, env = process.env, shell = false, logDir?: string) {
  const command = shell ? { file: bin, args } : executableCommand(bin, args, env);
  const stderrLog = logDir && join(logDir, "launch.stderr.log");
  let stdout: number | undefined;
  let stderr: number | undefined;
  let proc: ChildProcess;
  try {
    if (logDir) stdout = openSync(join(logDir, "launch.stdout.log"), "w");
    if (stderrLog) stderr = openSync(stderrLog, "w");
    proc = spawn(command.file, command.args, { cwd, env, shell, windowsHide: true, detached: true, stdio: ["ignore", stdout ?? "pipe", stderr ?? "pipe"] });
  } finally {
    if (stderr !== undefined) closeSync(stderr);
    if (stdout !== undefined) closeSync(stdout);
  }
  let output = "";
  let error = "";
  proc.stdout?.on("data", (data: Buffer) => {
    // Keep the beginning of adb's output, where the recording PID is printed.
    if (output.length < 4096) output += data.toString().slice(0, 4096 - output.length);
  });
  proc.stderr?.on("data", (data: Buffer) => { error = (error + data.toString()).slice(-4096); });
  const exited = new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
    proc.once("error", (e) => {
      error += String(e);
      if (stderrLog) {
        try { appendFileSync(stderrLog, String(e)); } catch {}
      }
      resolve();
    });
  });
  const kill = (signal: NodeJS.Signals) => killTree(proc.pid, signal);
  const release = adopt({ kill, exited });
  let done = false;
  void exited.then(() => { done = true; });
  return {
    exited, output: () => output, error: () => error, done: () => done,
    async stop() {
      kill("SIGINT");
      await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
      kill("SIGKILL"); release();
    },
  };
}

async function required(bin: string, args: string[], timeout?: number) {
  const result = await command(bin, args, process.env, timeout);
  if (!result.ok) throw new Error(result.text);
  return result.text;
}

async function nativeRecorder(target: Extract<Target, { kind: "ios" | "android" }>, dir: string, id: string) {
  // Transferring and encoding long recordings can take minutes on CI runners.
  const recordingTimeout = 10 * 60 * 1000;
  const segments: string[] = [];
  let stopped = false;
  let current: ReturnType<typeof owned> | undefined;
  let remotePid: string | undefined;
  let pendingPid: Promise<void> | undefined;
  const prefix = `proofed-${process.pid}-${Date.now()}`;
  const started = Date.now() / 1000;
  let began = () => {};
  const ready = new Promise<void>((r) => { began = r; });
  const loop = (async () => {
    do {
      const file = join(dir, `native-${segments.length}.mp4`);
      const remote = `/sdcard/${prefix}-${segments.length}.mp4`;
      current = target.kind === "ios"
        ? owned("xcrun", ["simctl", "io", id, "recordVideo", file])
        // One argument: adb joins shell arguments with spaces, so `sh -c <script>` would lose the script's arguments.
        : owned("adb", ["-s", id, "shell", `screenrecord --time-limit 175 ${remote} & p=$!; echo $p; wait $p`]);
      remotePid = undefined;
      if (target.kind === "android") {
        const pid = Promise.withResolvers<void>();
        pendingPid = pid.promise;
        for (let i = 0; i < 50 && !current.done(); i++) {
          remotePid = /^\d+/m.exec(current.output())?.[0];
          if (remotePid) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        pendingPid = undefined;
        pid.resolve();
      }
      if (target.kind === "android" && !remotePid) { await current.stop(); throw new Error(`screenrecord did not return its PID: ${current.error()}`); }
      began();
      await current.exited;
      remotePid = undefined;
      await current.stop();
      if (target.kind === "android") {
        const remove = ["-s", id, "shell", "rm", remote];
        try {
          await required("adb", ["-s", id, "pull", remote, file], recordingTimeout);
        } catch (error) {
          await command("adb", remove);
          throw error;
        }
        await required("adb", remove);
      }
      segments.push(file);
      if (!stopped && target.kind === "ios") break;
    } while (!stopped);
  })();
  // Attach the rejection handler now; stop() reports it after Kane finishes.
  void loop.catch(() => {});
  await Promise.race([ready, loop]);
  let stopping: Promise<Clip> | undefined;
  return {
    started,
    stop(): Promise<Clip> {
      return stopping ??= (async () => {
        stopped = true;
        if (target.kind === "android") {
          // A new segment can already be recording while adb is still reporting its PID.
          if (!remotePid && pendingPid) await pendingPid;
          if (remotePid) {
            const signal = await command("adb", ["-s", id, "shell", "kill", "-2", remotePid]);
            // The segment can expire while adb is delivering the signal.
            if (!signal.ok && !/no such process/i.test(signal.text)) throw new Error(signal.text);
          }
        } else await current?.stop();
        await loop;
        const list = join(dir, "segments.txt");
        writeFileSync(list, segments.map((f) => `file '${f.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`).join("\n"));
        const mp4 = join(dir, "clip.mp4"), jpg = join(dir, "clip.jpg"), gif = join(dir, "clip.gif");
        const untrimmed = join(dir, "clip-untrimmed.mp4");
        try {
          // Use a constant frame rate so the thumbnail seek finds a frame even when the Android screen stops changing.
          await required("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-vf", "fps=10,scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-bf", "0", "-pix_fmt", "yuv420p", untrimmed], recordingTimeout);
          const { text } = await command("ffmpeg", ["-hide_banner", "-i", untrimmed], process.env, recordingTimeout);
          const duration = /^\s*Duration: (\d+):(\d{2}):(\d{2}\.\d+),/m.exec(text);
          const seconds = duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : 0;
          // Kane closes the app at the end, so cut away the launcher frames.
          if (seconds > 3) await required("ffmpeg", ["-y", "-i", untrimmed, "-t", (seconds - 1.5).toFixed(2), "-c", "copy", mp4], recordingTimeout);
          else renameSync(untrimmed, mp4);
        } finally {
          rmSync(untrimmed, { force: true });
        }
        await required("ffmpeg", ["-y", "-sseof", "-0.1", "-i", mp4, "-frames:v", "1", jpg], recordingTimeout);
        await required("ffmpeg", ["-y", "-i", mp4, "-vf", "fps=6,scale=480:-1", gif], recordingTimeout);
        return { mp4, jpg, gif };
      })();
    },
  };
}

export type PreparedTarget = {
  kaneArgs: string[];
  recorder?: Awaited<ReturnType<typeof startRecorder>>;
  native?: Awaited<ReturnType<typeof nativeRecorder>>;
  clipEndpoint?: string;
  montage?: () => Promise<string>;
  cleanup: () => Promise<void>;
  metadata: { target: Target; recordingNote?: string };
};

const alive = (pid: number) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
};

// Darwin's O_EXLOCK is missing from Node's constants. Local devices only run on macOS.
const O_EXLOCK = 0x20;

export function lockDevice(id: string, dir = tmpdir()) {
  if (process.platform !== "darwin") throw new Error("Local mobile device locks require macOS");
  const lock = join(dir, `proofed-device-${id.replace(/[^\w-]/g, "_")}.lock`);
  const inUse = (owner?: number) => new Error(`Device ${id} is in use by another Proofed run${owner ? ` (pid ${owner})` : ""}. Wait for it to finish.`);
  // Keep the guard inode so every contender locks the same file, even during stale PID cleanup.
  // The kernel releases the guard if its owner dies.
  let guard: number;
  try {
    guard = openSync(`${lock}.guard`, constants.O_WRONLY | constants.O_CREAT | constants.O_NONBLOCK | constants.O_NOFOLLOW | O_EXLOCK, 0o600);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EAGAIN") throw inUse();
    throw e;
  }
  try {
    try {
      writeFileSync(lock, String(process.pid), { flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let owner = 0;
      try { owner = Number(readFileSync(lock, "utf8").trim()); } catch {}
      if (alive(owner)) throw inUse(owner);
      rmSync(lock, { recursive: true, force: true });
      writeFileSync(lock, String(process.pid), { flag: "wx" });
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      try { rmSync(lock, { force: true }); } finally { closeSync(guard); }
    };
  } catch (e) {
    closeSync(guard);
    throw e;
  }
}

export async function prepareTarget(target: Target, options: { dir: string; url?: string; headless?: boolean }): Promise<PreparedTarget> {
  mkdirSync(options.dir, { recursive: true });
  const cleanups: (() => Promise<unknown> | unknown)[] = [];
  const cleanup = async () => {
    for (const fn of cleanups.reverse()) {
      try { await fn(); } catch {}
    }
  };
  try {
    if (target.kind === "web") {
      const chrome = await launchChrome({ headless: options.headless ?? true });
      cleanups.push(() => chrome.close());
      const recorder = await startRecorder(chrome.endpoint, join(options.dir, "frames"));
      cleanups.push(() => recorder.stop());
      return { kaneArgs: ["--target", "desktop", "--url", options.url!, "--cdp-endpoint", chrome.endpoint], recorder, clipEndpoint: chrome.endpoint, cleanup, metadata: { target } };
    }
    if (target.kind === "desktop") {
      if (!target.cdp_endpoint || (!target.launch && !target.app && !target.reuse)) throw new Error("Desktop requires cdp_endpoint and launch or app, or explicit --reuse");
      if (target.launch || target.app) {
        // Refuse to launch over an endpoint belonging to another process.
        if (await cdpOccupied(target.cdp_endpoint)) throw new Error("CDP endpoint already answers; omit launch and app and pass --reuse");
        const env = { ...process.env };
        // Electron inherits this from some Node hosts and exits as a Node CLI instead of an app.
        delete env.ELECTRON_RUN_AS_NODE;
        let bin = target.launch ?? target.app!;
        const args: string[] = [];
        if (!target.launch) {
          if (bin.endsWith(".app")) {
            const executable = (await required("/usr/bin/plutil", ["-extract", "CFBundleExecutable", "raw", "-o", "-", join(bin, "Contents/Info.plist")])).trim();
            if (!executable || basename(executable) !== executable) throw new Error("Desktop .app has no valid CFBundleExecutable");
            bin = join(bin, "Contents/MacOS", executable);
          }
          const endpoint = new URL(target.cdp_endpoint);
          args.push(`--remote-debugging-port=${endpoint.port || (endpoint.protocol === "https:" ? "443" : "80")}`);
        }
        const app = owned(bin, args, target.dir, env, !!target.launch, options.dir);
        cleanups.push(() => app.stop());
      }
      let page: Awaited<ReturnType<typeof renderer>> | undefined;
      for (let i = 0; i < 100; i++) {
        try { page = await renderer(target.cdp_endpoint); break; } catch (e) { if (i === 99) throw e; }
        await new Promise((r) => setTimeout(r, 200));
      }
      const recorder = await startRecorder(target.cdp_endpoint, join(options.dir, "frames"), page!.id);
      cleanups.push(() => recorder.stop());
      return {
        kaneArgs: ["--target", "desktop", "--cdp-endpoint", target.cdp_endpoint, "--allow-missing-url"], recorder, cleanup, metadata: { target },
        montage: async () => { const chrome = await launchChrome(); cleanups.push(() => chrome.close()); return chrome.endpoint; },
      };
    }
    const checks = await targetChecks(target);
    const failed = checks.filter((c) => c.status === "fail");
    if (failed.length) throw new Error(failed.map((c) => `${c.name}: ${c.detail}. Fix: ${c.fix}`).join("\n"));
    let app = target.app!;
    if (isAppBundle(app)) {
      const temp = mkdtempSync(join(tmpdir(), "proofed-app-"));
      cleanups.push(() => rmSync(temp, { recursive: true, force: true }));
      const zip = join(temp, "simulator.zip");
      const result = await command("/usr/bin/ditto", ["-c", "-k", "--keepParent", join(dirname(app), basename(app)), zip]);
      if (!result.ok) throw new Error(result.text);
      app = zip;
    }
    const kaneArgs = ["--target", kaneTarget(target), "--app", app, ...(target.device ? ["--device-name", target.device] : []), ...(target.os_version ? ["--os-version", target.os_version] : [])];
    // Pass the file on every run, never replace it with an APP ID. Kane hashes its bytes before
    // looking up an upload, so a rebuild at the same path cannot select the old artifact.
    if (target.execution === "cloud") return { kaneArgs, cleanup, metadata: { target, recordingNote: "Cloud run, screenshot-only: no local MP4. Kane's report with the device screenshots is at kaneReport." } };
    const id = await localDevice(target);
    cleanups.push(lockDevice(id));
    const native = await nativeRecorder(target, options.dir, id);
    cleanups.push(() => native.stop());
    return { kaneArgs, native, cleanup, metadata: { target } };
  } catch (error) { await cleanup(); throw error; }
}
