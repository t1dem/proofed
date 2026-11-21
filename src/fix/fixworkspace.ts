import { execFileSync, spawn } from "node:child_process";
import { chmodSync, lstatSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { get as getHttp } from "node:http";
import { get as getHttps } from "node:https";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { offLimits } from "./guard.ts";
import { env } from "../env.ts";
import { gitPath } from "../paths.ts";
import { findGitBash, killTree } from "../process.ts";
import { fileWithSecret, holdCodexAuth, withoutJobSecrets } from "../secrets.ts";
import { timed } from "../timing.ts";

export const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: "pipe" }).trimEnd();

const sh = (word: string) => (/^[\w./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`);
// Claude Code allows a compound command only if each part of it is allowed on its own, so it refused
// `cd site && pnpm build`. Wrapped in a script, any build is one simple command, allowed exactly as is.
export function prepareBuild(appDir: string) {
  const buildInput = env("PROOFED_BUILD");
  const buildScript = join(process.env.RUNNER_TEMP || tmpdir(), "proofed-build.sh");
  const buildCommand = `bash ${sh(gitPath(buildScript))}`;
  writeFileSync(buildScript, `set -e -o pipefail\ncd ${sh(gitPath(resolve(appDir)))}\n${buildInput}\n`);
  return {
    buildInput, buildCommand, build: () => timed("rebuild", () => build(buildScript)), serve: () => serve(appDir),
    cleanup: () => rmSync(buildScript, { force: true }),
  };
}

function portOccupied(host: string, port: number) {
  return new Promise<boolean>((resolve, reject) => {
    const socket = createConnection({ host, port, signal: AbortSignal.timeout(2000) });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED") resolve(false);
      else reject(error);
    });
  });
}

function probe(url: URL, signal: AbortSignal) {
  const get = url.protocol === "https:" ? getHttps : getHttp;
  return new Promise<boolean>((resolve) => {
    get(url, { signal, agent: false }, (response) => {
      const status = response.statusCode ?? 0;
      response.destroy();
      resolve(status >= 200 && status < 400);
    }).on("error", () => resolve(false));
  });
}

// The Codex subscription login (auth.json in CODEX_HOME) is on disk only while the fixer runs, so the app's
// build and server, whose scripts the fixer can edit, can't read it. Returns what puts it back.
export function hideCodexAuth() {
  const file = process.env.CODEX_HOME ? join(process.env.CODEX_HOME, "auth.json") : undefined;
  let saved: string | undefined;
  try {
    if (file) saved = readFileSync(file, "utf8");
  } catch { /* no subscription login */ }
  if (!file || saved === undefined) return () => {};
  holdCodexAuth(saved);
  rmSync(file, { force: true });
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    // The build may have put a link in its place: remove it and create the file anew, never through a link.
    rmSync(file, { force: true, recursive: true });
    if (!lstatSync(dirname(file)).isDirectory()) throw new Error("CODEX_HOME was replaced while the app ran; Proofed won't write the Codex login there.");
    writeFileSync(file, saved, { mode: 0o600, flag: "wx" });
    chmodSync(file, 0o600);
    holdCodexAuth(undefined);
  };
}

async function serve(appDir: string) {
  const url = new URL(env("PROOFED_URL"));
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (await portOccupied(url.hostname.replace(/^\[|\]$/g, ""), port)) {
    throw new Error(`Port ${port} is already in use; stop the old server before Proofed starts the app.`);
  }
  // Read before the login leaves the disk: a missing command must not leave it there.
  const command = env("PROOFED_SERVE");
  const restoreAuth = hideCodexAuth();
  // The app's own commands get no job credentials, as in the check job's build and serve step.
  const proc = spawn(command, { shell: true, detached: true, windowsHide: true, stdio: "ignore", cwd: appDir, env: withoutJobSecrets(process.env) });
  const stopped = new AbortController();
  const exited = new Promise<void>((resolve) => {
    const leave = () => { stopped.abort(); resolve(); };
    proc.once("exit", leave);
    proc.once("error", leave);
  });
  const stop = async () => {
    killTree(proc.pid);
    await Promise.race([exited, setTimeout(3000, undefined, { ref: false })]);
    killTree(proc.pid, "SIGKILL");
    restoreAuth();
  };
  const startup = AbortSignal.any([stopped.signal, AbortSignal.timeout(30_000)]);
  try {
    while (!startup.aborted) {
      const signal = AbortSignal.any([startup, AbortSignal.timeout(1000)]);
      if (await probe(url, signal) && !startup.aborted) return stop;
      await setTimeout(500, undefined, { signal: startup }).catch(() => {});
    }
    throw new Error(stopped.signal.aborted ? `The serve command exited before ${url} was ready` : `App didn't come up at ${url} within 30 seconds`);
  } catch (e) {
    await stop();
    throw e;
  }
}

// What the fix has changed so far, new files included. -z: names as they are.
export const diffPaths = (...args: string[]) => git("diff", "--name-only", "--no-renames", "-z", ...args).split("\0").filter(Boolean);
export const untrackedPaths = () => git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean);
export const fixChanges = () => [...diffPaths("HEAD"), ...untrackedPaths()];
// Ignored files are not committed, but the build or the server can still put them on the page Kane records.
// node_modules alone lists far more than execFileSync's default 1 MiB of output.
export const ignoredUntrackedPaths = () => execFileSync("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], {
  encoding: "utf8", stdio: "pipe", maxBuffer: 512 * 1024 * 1024,
}).split("\0").filter(Boolean);
// ctime too: `touch` can set mtime back, but not the time the file itself last changed.
const writtenSince = (files: string[], since: number) => files.filter((file) => {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  return !!stat && Math.max(stat.mtimeMs, stat.ctimeMs) >= since;
});

export function changesLfsFiles(paths: string[], cached = false) {
  if (!paths.length) return false;
  const args = ["check-attr", ...(cached ? ["--cached"] : []), "-z", "--stdin", "filter"];
  const attributes = execFileSync("git", args, { input: `${paths.join("\0")}\0`, encoding: "utf8", stdio: "pipe" });
  return attributes.split("\0").some((value, i) => i % 3 === 2 && value === "lfs");
}

export const LFS_REFUSAL = "Proofed can't push changes to Git LFS files because its hook-free push cannot upload LFS objects.";

// Include new files and their contents when deciding whether an in-job result still applies.
export const fileStates = (files = fixChanges()) => new Map(files.map((file) => {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return [file, "deleted"] as const;
  const content = stat.isSymbolicLink() ? readlinkSync(file) : stat.isFile() ? git("hash-object", "--no-filters", "--", file) : "";
  return [file, `${stat.mode}:${content}`] as const;
}));
// Staging can move a file from the untracked list to the tracked list without changing its contents.
export function treeBeforeCheck() {
  const changes = git("diff", "--raw", "--no-renames", "--ignore-submodules=none", "-z", "HEAD").split("\0");
  const untracked = untrackedPaths();
  if (changes.some((entry, i) => i % 2 === 0 && /^:(?:160000 |\d+ 160000 )/.test(entry)) || untracked.some((file) => file.endsWith("/"))) {
    throw new Error("Proofed can't verify a fix with changed or dirty Git submodules.");
  }
  const files = [...changes.filter((_, i) => i % 2 === 1), ...untracked];
  const states = fileStates(files);
  if (changesLfsFiles(files.filter((file) => states.get(file) !== "deleted"))) throw new Error(LFS_REFUSAL);
  return [...states].map(([file, state]) => `${file}\0${state}`).sort().join("\0");
}

// Ignore rules mark build output even if the project tracks it and the fixer rebuilds it.
// Include HEAD entries so staged deletions are matched too.
export const ignoredTrackedPaths = () => new Set(git("ls-files", "-z", "--cached", "--ignored", "--exclude-standard", "--with-tree=HEAD").split("\0").filter(Boolean));

// Checked before the change is built, served to Kane and recorded, since clips and reports are public.
// `since`: when the agent started, so ignored files it wrote are checked too, not the whole dependency tree.
export function discardLeak(agentName: string, since?: number) {
  // A second of slack for file systems with coarse timestamps.
  const ignored = since === undefined ? [] : writtenSince(ignoredUntrackedPaths(), since - 1000);
  const leaked = fileWithSecret([...fixChanges(), ...ignored]);
  if (!leaked) return undefined;
  git("restore", "--source=HEAD", "--staged", "--worktree", "--", ".");
  for (const file of [...untrackedPaths(), ...ignored]) rmSync(file, { force: true });
  return `${agentName}'s change put a credential of this job into ${leaked}. Proofed discarded the change`;
}

function build(buildScript: string) {
  const restoreAuth = hideCodexAuth();
  try {
    // The fixer can build on its own. Only Proofed's build can supply ignored tracked output to Kane.
    const ignored = ignoredTrackedPaths();
    const changedOutputs = diffPaths("HEAD").filter((file) => ignored.has(file));
    if (changedOutputs.length) git("--literal-pathspecs", "restore", "--source=HEAD", "--staged", "--worktree", "--", ...changedOutputs);
    execFileSync(findGitBash(), [gitPath(buildScript)], { stdio: "pipe", windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: withoutJobSecrets(process.env) });
    const scenariosDir = env("PROOFED_SCENARIOS", ".proofed/scenarios");
    const protectedFiles = fixChanges().filter((file) => offLimits(file, scenariosDir));
    if (protectedFiles.length) return `The build changed protected files: ${protectedFiles.join(", ")}.`;
    return undefined;
  } catch (e) {
    return e instanceof Error && "stdout" in e && "stderr" in e ? `${e.stdout}${e.stderr}` : String(e);
  } finally {
    restoreAuth();
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

export function stagedFilesMatch() {
  if (git("diff", "--name-only", "--ignore-submodules=none", "-z")) return false;
  const entries = git("diff", "--cached", "--raw", "--no-abbrev", "--no-renames", "-z", "HEAD").split("\0");
  for (let i = 0; i + 1 < entries.length; i += 2) {
    const [, mode, , oid] = entries[i]!.split(" ");
    if (mode === "000000") continue;
    const file = entries[i + 1]!;
    const stat = lstatSync(file);
    if (mode === "120000") {
      const link = stat.isSymbolicLink() ? readlinkSync(file, { encoding: "buffer" }) : readFileSync(file);
      if (!execFileSync("git", ["cat-file", "blob", oid!], { stdio: "pipe" }).equals(link)) return false;
    } else {
      if (!stat.isFile() || (process.platform !== "win32" && !!(stat.mode & 0o100) !== (mode === "100755"))) return false;
      // Checkout filters can change the bytes even when the staged blob matches the checked file.
      const content = readFileSync(file);
      const checkedOut = execFileSync("git", ["cat-file", "--filters", `--path=${file}`, oid!], {
        maxBuffer: Math.max(1024 * 1024, content.length + 1), stdio: "pipe",
      });
      if (!content.equals(checkedOut)) return false;
    }
  }
  return true;
}
