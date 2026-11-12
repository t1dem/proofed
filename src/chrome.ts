import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const candidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
];

const chromePath = () => {
  const found = candidates.find((p): p is string => !!p && existsSync(p));
  if (!found) throw new Error("Chrome not found; set CHROME_PATH");
  return found;
};

// We start Chrome ourselves (instead of letting Kane do it) so the recorder can attach to the same browser.
export async function launchChrome({ headless = true } = {}) {
  const port = 9222 + Math.floor(Math.random() * 1000);
  const proc = spawn(
    chromePath(),
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${mkdtempSync(join(tmpdir(), "proofed-chrome-"))}`,
      "--window-size=1280,800",
      "--no-first-run",
      "--no-default-browser-check",
      "--mute-audio",
      ...(headless ? ["--headless=new"] : []),
      ...(process.env.CI ? ["--no-sandbox"] : []),
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const endpoint = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${endpoint}/json/version`);
      if (res.ok) return { endpoint, close: () => proc.kill() };
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error("Chrome did not open its debugging port");
}
