import { spawn, spawnSync, type SpawnOptions, type StdioOptions } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "../env.ts";
import { findGitBash } from "../process.ts";
import { maskSecrets } from "../secrets.ts";

export const runnerFile = (name: string) => join(env("RUNNER_TEMP"), name);

// Pass arguments through Git Bash on Windows too, where npm and npx may be .cmd shims.
// The shell source is fixed and never interpolates arguments or credentials.
export const bash = (file: string, args: string[]) => ["-c", 'exec "$@"', "proofed", file, ...args];

export class CommandFailure extends Error {
  exitCode: number;
  constructor(label: string, code: number) {
    super(`${label} exited with code ${code}.`);
    this.exitCode = code;
  }
}

export function run(file: string, args: string[], options: SpawnOptions = {}, label = file) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(file, args, { stdio: "inherit", windowsHide: true, ...options });
    child.once("error", () => reject(new Error(`Couldn't start ${label}.`)));
    child.once("close", (code) => code === 0 ? resolve() : reject(new CommandFailure(label, code ?? 1)));
  });
}

export function runBash(file: string, args: string[], options?: SpawnOptions) {
  return run(findGitBash(), bash(file, args), options, file);
}

export function capture(file: string, args: string[], cwd?: string, stderr = false) {
  const result = spawnSync(findGitBash(), bash(file, args), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, cwd });
  if (result.status !== 0) return undefined;
  return (stderr ? result.stderr : result.stdout).trim();
}

export const quiet: StdioOptions = ["ignore", "ignore", "inherit"];

export function output(values: Record<string, string | boolean | undefined>) {
  const lines = Object.entries(values).flatMap(([key, value]) => {
    if (value === undefined) return [];
    if (/[\r\n]/.test(String(value))) {
      // GitHub's file command supports newline-delimited cache paths.
      const marker = `proofed_${crypto.randomUUID()}`;
      return [`${key}<<${marker}\n${value}\n${marker}\n`];
    }
    return [`${key}=${value}\n`];
  });
  appendFileSync(env("GITHUB_OUTPUT"), lines.join(""));
}

export function actionError(error: unknown) {
  console.error(maskSecrets(error instanceof Error ? error.message : String(error)));
  process.exitCode = error instanceof CommandFailure ? error.exitCode : 1;
}
