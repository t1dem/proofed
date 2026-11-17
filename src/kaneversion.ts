import { execFileSync } from "node:child_process";

export function readKaneVersion(bin: string, env = process.env): string {
  try {
    const stdout = execFileSync(bin, ["--version"], { env, encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "pipe"] });
    // Match a version line, so runtime warnings cannot become part of the cache identity.
    return /^\s*v?(\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?)\s*$/m.exec(stdout)?.[1] ?? "unknown";
  } catch { return "unknown"; }
}
