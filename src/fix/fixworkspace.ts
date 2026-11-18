import { execFileSync, spawn } from "node:child_process";
import { lstatSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { offLimits } from "./guard.ts";
import { env } from "../env.ts";
import { findGitBash, killTree } from "../process.ts";
import { fileWithSecret } from "../secrets.ts";
import { timed } from "../timing.ts";

export const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trimEnd();

const sh = (word: string) => (/^[\w./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`);
// Claude Code allows a compound command only if each part of it is allowed on its own, so it refused
// `cd site && pnpm build`. Wrapped in a script, any build is one simple command, allowed exactly as is.
export function prepareBuild(appDir: string) {
  const buildInput = env("PROOFED_BUILD");
  const buildScript = join(process.env.RUNNER_TEMP || tmpdir(), "proofed-build.sh");
  const buildCommand = `bash ${sh(buildScript.replaceAll("\\", "/"))}`;
  writeFileSync(buildScript, `set -e -o pipefail\ncd ${sh(resolve(appDir).replaceAll("\\", "/"))}\n${buildInput}\n`);
  return {
    buildInput, buildCommand, build: () => timed("rebuild", () => build(buildScript)), serve: () => serve(appDir),
    cleanup: () => rmSync(buildScript, { force: true }),
  };
}

async function serve(appDir: string) {
  const proc = spawn(env("PROOFED_SERVE"), { shell: true, detached: true, windowsHide: true, stdio: "ignore", cwd: appDir });
  const exited = new Promise<void>((resolve) => { proc.once("exit", () => resolve()); proc.once("error", () => resolve()); });
  const stop = async () => {
    killTree(proc.pid);
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
    killTree(proc.pid, "SIGKILL");
  };
  const url = env("PROOFED_URL");
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) return stop;
    } catch {
      // Still starting.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  await stop();
  throw new Error(`App didn't come up at ${url}`);
}

// What the fix has changed so far, new files included. -z: names as they are.
export const diffPaths = (...args: string[]) => git("diff", "--name-only", "--no-renames", "-z", ...args).split("\0").filter(Boolean);
export const untrackedPaths = () => git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean);
export const fixChanges = () => [...diffPaths("HEAD"), ...untrackedPaths()];

// Include new files and their contents when deciding whether an in-job result still applies.
export const fileStates = () => new Map(fixChanges().map((file) => {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return [file, "deleted"] as const;
  const content = stat.isSymbolicLink() ? readlinkSync(file) : stat.isFile() ? git("hash-object", "--no-filters", "--", file) : "";
  return [file, `${stat.mode}:${content}`] as const;
}));
// Staging can move a file from the untracked list to the tracked list without changing its contents.
export const treeBeforeCheck = () => [...fileStates()].map(([file, state]) => `${file}\0${state}`).sort().join("\0");

// Ignore rules mark build output even if the project tracks it and the fixer rebuilds it.
// Include HEAD entries so staged deletions are matched too.
export const ignoredTrackedPaths = () => new Set(git("ls-files", "-z", "--cached", "--ignored", "--exclude-standard", "--with-tree=HEAD").split("\0").filter(Boolean));

// Checked before the change is built, served to Kane and recorded, since clips and reports are public.
export function discardLeak(agentName: string) {
  const leaked = fileWithSecret(fixChanges());
  if (!leaked) return undefined;
  const untracked = untrackedPaths();
  git("checkout", "--", ".");
  for (const file of untracked) rmSync(file, { force: true });
  return `${agentName}'s change put a credential of this job into ${leaked}. Proofed discarded the change`;
}

function build(buildScript: string) {
  try {
    // The fixer can build on its own. Only Proofed's build can supply ignored tracked output to Kane.
    const ignored = ignoredTrackedPaths();
    const changedOutputs = diffPaths("HEAD").filter((file) => ignored.has(file));
    if (changedOutputs.length) git("--literal-pathspecs", "restore", "--source=HEAD", "--staged", "--worktree", "--", ...changedOutputs);
    execFileSync(findGitBash(), [buildScript.replaceAll("\\", "/")], { stdio: "pipe", windowsHide: true });
    const scenariosDir = env("PROOFED_SCENARIOS", ".proofed/scenarios");
    const protectedFiles = fixChanges().filter((file) => offLimits(file, scenariosDir));
    if (protectedFiles.length) return `The build changed protected files: ${protectedFiles.join(", ")}.`;
    return undefined;
  } catch (e) {
    return e instanceof Error && "stdout" in e && "stderr" in e ? `${e.stdout}${e.stderr}` : String(e);
  }
}

export function stageCheckedFiles(agentTouched: Set<string>) {
  // Start from HEAD's index so the fixer or build cannot stage an unchecked version of a file.
  // git add -u captures the checked contents of every tracked path, including generated output.
  git("read-tree", "HEAD");
  git("add", "-u");
  const added = untrackedPaths().filter((file) => agentTouched.has(file));
  if (added.length) git("--literal-pathspecs", "add", "--", ...added);
}
