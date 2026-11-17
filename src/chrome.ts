import { killTree } from "./process.ts";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { adopt, stopping } from "./children.ts";
import { log } from "./log.ts";

export function chromeCandidates(env = process.env, platform = process.platform) {
  return [env.CHROME_PATH, ...(platform === "win32"
    ? [env.ProgramFiles ?? "C:\\Program Files", env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", env.LOCALAPPDATA]
      .filter((p): p is string => !!p).map((p) => win32.join(p, "Google", "Chrome", "Application", "chrome.exe"))
    : ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"])]
    .filter((p): p is string => !!p);
}

export const findChrome = (env = process.env, platform = process.platform) => chromeCandidates(env, platform).find((p) => existsSync(p));

const chromePath = () => {
  const found = findChrome();
  if (!found) throw new Error("Chrome not found; set CHROME_PATH");
  return found;
};

// We start Chrome ourselves (instead of letting Kane do it) so the recorder can attach to the same browser.
// Chrome picks a free debugging port and writes it to DevToolsActivePort in its profile folder.
// A cold runner can take a while to start the first Chrome, so it gets 30 s and one more try.
export async function launchChrome({ headless = true } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await startChrome(headless);
    } catch (e) {
      if (attempt >= 2 || stopping()) throw e;
      log(`${e instanceof Error ? e.message : e}; starting Chrome again`);
    }
  }
}

async function startChrome(headless: boolean) {
  const bin = chromePath();
  const profile = mkdtempSync(join(tmpdir(), "proofed-chrome-"));
  const proc = spawn(
    bin,
    [
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--window-size=1280,800",
      "--no-first-run",
      "--no-default-browser-check",
      "--mute-audio",
      ...(headless ? ["--headless=new"] : []),
      ...(process.env.CI ? ["--no-sandbox"] : []),
      "about:blank",
    ],
    { stdio: "ignore", detached: process.platform !== "win32", windowsHide: true },
  );
  let failure: Error | undefined;
  const kill = (signal: NodeJS.Signals = "SIGTERM") => killTree(proc.pid, signal);
  const { promise: exited, resolve: done } = Promise.withResolvers<void>();
  const release = adopt({ kill, exited });
  const finished = (error: Error) => {
    failure = error;
    // The browser can exit before its renderer and GPU helpers.
    if (process.platform !== "win32") kill("SIGKILL");
    release();
    done();
    // A profile is a few megabytes, one per Chrome; a laptop keeps its temp folder.
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 2 });
    } catch {
      // A helper still writing into it; the OS cleans the temp folder eventually.
    }
  };
  proc.once("error", finished);
  proc.once("exit", (code) => finished(new Error(`Chrome exited with code ${code} on start`)));

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !failure) {
    const port = existsSync(join(profile, "DevToolsActivePort"))
      ? readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]?.trim()
      : undefined;
    if (port) {
      const endpoint = `http://127.0.0.1:${port}`;
      const ok = await fetch(`${endpoint}/json/version`).then((r) => r.ok, () => false);
      if (ok) return { endpoint, close: () => kill() };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  kill();
  throw failure ?? new Error("Chrome did not open its debugging port");
}
