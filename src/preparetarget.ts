import { executableCommand, killTree } from "./process.ts";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { adopt } from "./children.ts";
import { launchChrome } from "./chrome.ts";
import { command, kaneTarget, localDevice, renderer, targetChecks } from "./targetchecks.ts";
import { startRecorder } from "./recorder.ts";
import type { Clip } from "./run.ts";
import type { Target } from "./target.ts";

function owned(bin: string, args: string[], cwd?: string, env = process.env, shell = false) {
  const command = shell ? { file: bin, args } : executableCommand(bin, args, env);
  const proc = spawn(command.file, command.args, { cwd, env, shell, windowsHide: true, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let error = "";
  proc.stdout.on("data", (data) => { output += data; });
  proc.stderr.on("data", (data) => { error += data; });
  const exited = new Promise<void>((resolve) => { proc.once("exit", () => resolve()); proc.once("error", (e) => { error += String(e); resolve(); }); });
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

async function required(bin: string, args: string[]) {
  const result = await command(bin, args);
  if (!result.ok) throw new Error(result.text);
  return result.text;
}

async function nativeRecorder(target: Extract<Target, { kind: "ios" | "android" }>, dir: string, id: string) {
  const segments: string[] = [];
  let stopped = false;
  let current: ReturnType<typeof owned> | undefined;
  let remotePid: string | undefined;
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
        : owned("adb", ["-s", id, "shell", "sh", "-c", `screenrecord --time-limit 175 ${remote} & p=$!; echo $p; wait $p`]);
      remotePid = undefined;
      if (target.kind === "android") {
        for (let i = 0; i < 50 && !current.done(); i++) {
          remotePid = /^\d+/m.exec(current.output())?.[0];
          if (remotePid) break;
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      if (target.kind === "android" && !remotePid) { await current.stop(); throw new Error(`screenrecord did not return its PID: ${current.error()}`); }
      began();
      await current.exited;
      if (target.kind === "android") {
        await required("adb", ["-s", id, "pull", remote, file]);
        await required("adb", ["-s", id, "shell", "rm", remote]);
      }
      await current.stop();
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
        if (target.kind === "android" && remotePid) await required("adb", ["-s", id, "shell", "kill", "-2", remotePid]);
        if (target.kind === "ios") await current?.stop();
        await loop;
        const list = join(dir, "segments.txt");
        writeFileSync(list, segments.map((f) => `file '${f.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`).join("\n"));
        const mp4 = join(dir, "clip.mp4"), jpg = join(dir, "clip.jpg"), gif = join(dir, "clip.gif");
        await required("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p", mp4]);
        await required("ffmpeg", ["-y", "-sseof", "-0.1", "-i", mp4, "-frames:v", "1", jpg]);
        await required("ffmpeg", ["-y", "-i", mp4, "-vf", "fps=6,scale=480:-1", gif]);
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

// One run per local device. The lock holds the owner's pid, so a lock left by a run that was killed
// outright (or an old directory-style lock) is taken over instead of blocking the device for good.
export function lockDevice(id: string, dir = tmpdir()) {
  const lock = join(dir, `proofed-device-${id.replace(/[^\w-]/g, "_")}.lock`);
  for (let attempt = 0; ; attempt++) {
    try {
      writeFileSync(lock, String(process.pid), { flag: "wx" });
      return () => rmSync(lock, { force: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let owner = 0;
      try { owner = Number(readFileSync(lock, "utf8").trim()); } catch {}
      if (attempt > 0 || alive(owner)) throw new Error(`Device ${id} is in use by another Proofed run${owner ? ` (pid ${owner})` : ""}. Wait for it to finish, or delete ${lock}.`);
      rmSync(lock, { recursive: true, force: true });
    }
  }
}

export async function prepareTarget(target: Target, options: { dir: string; url?: string; headless?: boolean }): Promise<PreparedTarget> {
  mkdirSync(options.dir, { recursive: true });
  const cleanups: (() => Promise<unknown> | unknown)[] = [];
  const cleanup = async () => { for (const fn of cleanups.reverse()) await Promise.resolve(fn()).catch(() => {}); };
  try {
    if (target.kind === "web") {
      const chrome = await launchChrome({ headless: options.headless ?? true });
      cleanups.push(() => chrome.close());
      const recorder = await startRecorder(chrome.endpoint, join(options.dir, "frames"));
      cleanups.push(() => recorder.stop());
      return { kaneArgs: ["--target", "desktop", "--url", options.url!, "--cdp-endpoint", chrome.endpoint], recorder, clipEndpoint: chrome.endpoint, cleanup, metadata: { target } };
    }
    if (target.kind === "desktop") {
      if (!target.cdp_endpoint || (!target.launch && !target.reuse)) throw new Error("Desktop requires cdp_endpoint and launch, or explicit --reuse");
      if (target.launch) {
        // Refuse to launch over an endpoint belonging to another process.
        const occupied = await fetch(new URL("/json/version", target.cdp_endpoint), { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
        if (occupied) throw new Error("CDP endpoint already answers; omit launch and pass --reuse");
        const env = { ...process.env };
        // Electron inherits this from some Node hosts and exits as a Node CLI instead of an app.
        delete env.ELECTRON_RUN_AS_NODE;
        const app = owned(target.launch, [], target.dir, env, true);
        cleanups.push(async () => {
          await app.stop();
          writeFileSync(join(options.dir, "launch.stdout.log"), app.output());
          writeFileSync(join(options.dir, "launch.stderr.log"), app.error());
        });
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
    if (app.endsWith(".app")) {
      const temp = mkdtempSync(join(tmpdir(), "proofed-app-"));
      cleanups.push(() => rmSync(temp, { recursive: true, force: true }));
      const zip = join(temp, "simulator.zip");
      const result = await command("/usr/bin/ditto", ["-c", "-k", "--keepParent", join(dirname(app), basename(app)), zip]);
      if (!result.ok) throw new Error(result.text);
      app = zip;
    }
    const kaneArgs = ["--target", kaneTarget(target), "--app", app, ...(target.device ? ["--device-name", target.device] : []), ...(target.os_version ? ["--os-version", target.os_version] : [])];
    if (target.execution === "cloud") return { kaneArgs, cleanup, metadata: { target, recordingNote: "Cloud run, screenshot-only: no local MP4. Kane's report with the device screenshots is at kaneReport." } };
    const id = await localDevice(target);
    cleanups.push(lockDevice(id));
    const native = await nativeRecorder(target, options.dir, id);
    cleanups.push(() => native.stop());
    return { kaneArgs, native, cleanup, metadata: { target } };
  } catch (error) { await cleanup(); throw error; }
}
