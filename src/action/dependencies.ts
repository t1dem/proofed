import { createHash } from "node:crypto";
import { existsSync, globSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { actionError, capture, output } from "./command.ts";

const locks = {
  npm: ["package-lock.json", "npm-shrinkwrap.json"],
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
};
type Manager = keyof typeof locks;

function isManager(name: string): name is Manager {
  return Object.hasOwn(locks, name);
}

function within(parent: string, child: string) {
  const path = relative(parent, child);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function projectDirs(workspace: string, cwd: string) {
  const dirs = [cwd];
  while (cwd !== workspace && within(workspace, cwd)) {
    cwd = dirname(cwd);
    dirs.push(cwd);
  }
  return dirs;
}

export function packageProject(dirs: string[], requested?: string) {
  if (requested && !isManager(requested)) throw new Error(`Unsupported package cache ${requested}.`);
  const managers = requested && isManager(requested) ? [requested] : (Object.keys(locks) as Manager[]);
  for (const dir of dirs) {
    for (const manager of managers) {
      const lock = locks[manager].map((file) => join(dir, file)).find(existsSync);
      if (lock) return { dir, manager, lock };
    }
  }
  if (requested) throw new Error(`No ${requested} lockfile found for the package cache.`);
  return undefined;
}

function hashFiles(dir: string, files: string[]) {
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(relative(dir, file).replaceAll(sep, "/") + "\0");
    hash.update(createHash("sha256").update(readFileSync(file)).digest());
  }
  return hash.digest("hex");
}

export function storePath(manager: Manager, version: string, cwd: string, query: typeof capture) {
  if (manager === "npm") {
    const dir = query("npm", ["config", "get", "cache"], cwd);
    // npm's separate _npx directory contains installed node_modules.
    return dir && resolve(cwd, dir, "_cacache");
  }
  if (manager === "pnpm") {
    const dir = query("pnpm", ["store", "path", "--silent"], cwd);
    return dir && resolve(cwd, dir);
  }
  const args = version.startsWith("1.") ? ["cache", "dir"] : ["config", "get", "cacheFolder"];
  const dir = query("yarn", args, cwd);
  return dir && resolve(cwd, dir);
}

function canonicalPath(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path ? path : resolve(canonicalPath(parent), relative(parent, path));
}

function safeStore(path: string, workspace: string, cwd: string) {
  const real = canonicalPath(path);
  return [path, real].every((candidate) =>
    !candidate.split(/[\\/]/).some((part) => part.toLowerCase() === "node_modules")
    && !within(candidate, canonicalPath(workspace)) && !within(candidate, canonicalPath(cwd)),
  );
}

export function packageCache(project: NonNullable<ReturnType<typeof packageProject>>, cwd: string, workspace: string, platform: string, query = capture) {
  const { manager, lock } = project;
  const version = query(manager, ["--version"], cwd);
  if (!version || !/^\d+\.\d+\.\d+[\w.+-]*$/.test(version)) throw new Error(`Couldn't read the ${manager} version for the package cache.`);
  const path = storePath(manager, version, cwd, query);
  if (!path) throw new Error(`Couldn't locate the ${manager} package store.`);
  if (!safeStore(path, workspace, cwd)) return undefined;
  const prefix = `proofed-store-v1-${platform}-node-${process.versions.node}-${manager}-${version}-`;
  const key = prefix + hashFiles(project.dir, [lock]);
  const restoreKeys: string[] = [];
  if (manager !== "npm") {
    // setup-node used the runner's hashFiles digest. pnpm and Yarn still use the same store paths.
    const oldHash = createHash("sha256").update(createHash("sha256").update(readFileSync(lock)).digest()).digest("hex");
    const runnerOS = platform.slice(0, platform.lastIndexOf("-"));
    const oldPrefix = `node-cache-${runnerOS}-${process.arch}-${manager}`;
    restoreKeys.push(`${oldPrefix}-${oldHash}`);
    if (manager === "yarn" && !version.startsWith("1.") && query("yarn", ["config", "get", "enableGlobalCache"], cwd) === "false") {
      // setup-node also restored earlier lockfile caches for a project-managed Yarn Berry store.
      restoreKeys.push(prefix, oldPrefix);
    }
  }
  return { path, key, restoreKeys: restoreKeys.join("\n") };
}

export function gradleCache(dirs: string[], userHome: string, platform: string, javaVersion: string) {
  const wrapper = "gradle/wrapper/gradle-wrapper.properties";
  const dir = dirs.find((dir) => existsSync(join(dir, wrapper)));
  if (!dir) return undefined;
  const distribution = /^distributionUrl\s*=.*\/gradle-([\w.-]+)-(?:bin|all)\.zip\s*$/m.exec(readFileSync(join(dir, wrapper), "utf8"));
  const version = distribution?.[1] ?? "wrapper";
  const files = globSync([
    "**/*.gradle", "**/*.gradle.kts", "**/gradle.properties", "**/gradle.lockfile", "**/*.lockfile",
    "**/gradle-wrapper.properties", "**/gradle/*.toml", "**/gradle/verification-metadata.xml",
  ], { cwd: dir, exclude: ["**/.git", "**/node_modules", "**/.gradle", "**/build"] }).map((file) => join(dir, file));
  const hash = hashFiles(dir, [...new Set([join(dir, wrapper), ...files])]);
  const java = createHash("sha256").update(javaVersion).digest("hex").slice(0, 16);
  return {
    path: [join(userHome, "caches"), join(userHome, "wrapper")].join("\n"),
    key: `proofed-gradle-v1-${platform}-${version}-java-${java}-${hash}`,
  };
}

function discoverCaches() {
  const env = process.env;
  const workspace = resolve(env.GITHUB_WORKSPACE || process.cwd());
  const cwd = resolve(workspace, env.PROOFED_DIR || ".");
  const dirs = projectDirs(workspace, cwd);
  const platform = `${env.RUNNER_OS ?? process.platform}-${env.RUNNER_ARCH ?? process.arch}`;
  const requested = env.PROOFED_CACHE;
  const project = requested || env.PROOFED_DISCOVER_CACHE === "true" ? packageProject(dirs, requested) : undefined;
  // The standalone fixer never needed a cache, so discovery can fail without blocking its install.
  let packages;
  if (project) {
    try { packages = packageCache(project, cwd, workspace, platform); }
    catch (e) { if (requested) throw e; }
  }
  const gradleHome = resolve(cwd, env.GRADLE_USER_HOME || join(homedir(), ".gradle"));
  let gradle;
  try {
    if (dirs.some((dir) => existsSync(join(dir, "gradle/wrapper/gradle-wrapper.properties"))) &&
        safeStore(join(gradleHome, "caches"), workspace, cwd) && safeStore(join(gradleHome, "wrapper"), workspace, cwd)) {
      gradle = gradleCache(dirs, gradleHome, platform, capture("java", ["-version"], cwd, true) ?? env.JAVA_VERSION ?? "");
    }
  } catch {
    console.log("Couldn't locate the Gradle cache.");
  }
  output({
    package_path: packages?.path, package_key: packages?.key, package_restore: packages?.restoreKeys,
    gradle_path: gradle?.path, gradle_key: gradle?.key,
  });
}

if (import.meta.main) {
  try { discoverCaches(); }
  catch (e) { actionError(e); }
}
