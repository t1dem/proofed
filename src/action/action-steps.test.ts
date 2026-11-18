import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { appPort } from "./app.ts";
import { waitForCodex } from "./background.ts";
import { gradleCache, packageCache, packageProject, storePath } from "./dependencies.ts";
import { fixRefs } from "./pr.ts";
import { runtimeEnv } from "./runtime.ts";
import { ffmpegBuild, toolPlan } from "./tools.ts";

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "proofed-action-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("tool keys pin exact versions and distinguish OS and architecture", () => {
  const env = { RUNNER_OS: "Linux", RUNNER_ARCH: "ARM64", RUNNER_TEMP: "/temp", PROOFED_KANE_VERSION: "0.10.4" };
  const check = toolPlan(env, "codex");
  assert.equal(check.kaneKey, undefined);
  assert.equal(check.codexKey, undefined);
  assert.equal(check.background, false);
  assert.equal(toolPlan({ ...env, PROOFED_KANE_VERSION: "latest" }).kaneKey, undefined);
  const auto = toolPlan({ ...env, PROOFED_AUTOFIX: "true" }, "codex");
  assert.equal(auto.codexKey, "proofed-cli-v1-codex-0.169.0-Linux-ARM64");
  assert.equal(auto.background, true);
  assert.equal(auto.syncProvider, undefined);
  for (const mode of [{ PROOFED_MODE: "fix" }, { PROOFED_GENERATE: "true" }, { PROOFED_LEGACY_FIX: "true" }]) {
    const fix = toolPlan({ ...env, ...mode, PROOFED_AUTOFIX: "true" }, "codex");
    assert.equal(fix.syncProvider, "codex");
    assert.equal(fix.background, false);
  }
  assert.equal(toolPlan({ ...env, PROOFED_AUTOFIX: "true" }, "claude").codexKey, undefined);
});

test("ffmpeg selects only supported Linux archives and pins their checksums", () => {
  const root = "/runner/cache";
  assert.deepEqual(ffmpegBuild("Linux", "X64", root), {
    dir: join(root, "proofed-ffmpeg"),
    key: "proofed-ffmpeg-b6.1.1-Linux-x64",
    legacy: "proofed-ffmpeg-b6.1.1-x64",
    url: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-x64.gz",
    sha256: "bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa",
  });
  const arm64 = ffmpegBuild("Linux", "ARM64", root);
  assert.match(arm64?.url ?? "", /ffmpeg-linux-arm64\.gz$/);
  assert.equal(arm64?.sha256, "754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0");
  for (const [os, arch] of [["macOS", "ARM64"], ["Windows", "X64"], ["Linux", "ARM"]] as const) {
    assert.equal(ffmpegBuild(os, arch, root), undefined);
  }
});

test("package cache uses the app lock and includes tool versions without caching node_modules", (t) => {
  const root = fixture(t);
  const app = join(root, "site");
  mkdirSync(app);
  const rootLock = join(root, "pnpm-lock.yaml");
  const appLock = join(app, "pnpm-lock.yaml");
  writeFileSync(rootLock, "root lock");
  assert.equal(packageProject([app, root], "pnpm")?.lock, rootLock);
  writeFileSync(appLock, "app lock");
  const project = packageProject([app, root], "pnpm")!;
  assert.equal(project.lock, appLock);
  assert.equal(packageProject([app, root])?.manager, "pnpm");
  assert.throws(() => packageProject([app, root], "npm"), /No npm lockfile/);
  assert.throws(() => packageProject([app, root], "bun"), /Unsupported package cache/);

  const store = join(root, "stores", "v10");
  const query = (_bin: string, args: string[], cwd?: string) => {
    assert.equal(cwd, app);
    return args[0] === "--version" ? "10.20.0" : store;
  };
  const read = () => packageCache(project, app, root, "Linux-X64", query);
  const cached = read();
  assert.equal(cached?.path, store);
  assert.match(cached?.key ?? "", /^proofed-store-v1-Linux-X64-node-[\d.]+-pnpm-10\.20\.0-[a-f0-9]{64}$/);
  assert.match(cached?.restoreKeys ?? "", /^node-cache-Linux-[\w]+-pnpm-[a-f0-9]{64}$/);
  writeFileSync(appLock, "other app lock");
  assert.notEqual(read()?.key, cached?.key);
  const updated = read()?.key;
  writeFileSync(rootLock, "other root lock");
  assert.equal(read()?.key, updated);
  for (const unsafe of [join(app, "node_modules", "store"), root, app]) {
    assert.equal(packageCache(project, app, root, "Linux-X64", (_bin, args) => args[0] === "--version" ? "10.20.0" : unsafe), undefined);
  }
});

test("npm limits its cache to the package store and Yarn uses version-specific commands", (t) => {
  const dir = fixture(t);
  const query = (bin: string, args: string[]) => {
    assert.equal(bin, "npm");
    assert.deepEqual(args, ["config", "get", "cache"]);
    return join(dir, ".npm");
  };
  assert.equal(storePath("npm", "11.6.0", dir, query), join(dir, ".npm", "_cacache"));
  for (const [version, expected] of [["1.22.22", ["cache", "dir"]], ["4.5.0", ["config", "get", "cacheFolder"]]] as const) {
    assert.equal(storePath("yarn", version, dir, (bin, args) => {
      assert.equal(bin, "yarn");
      assert.deepEqual(args, expected);
      return ".yarn/cache";
    }), join(dir, ".yarn", "cache"));
  }
});

test("a project-managed Yarn Berry cache can restore earlier lockfile stores", (t) => {
  const dir = fixture(t);
  const lock = join(dir, "yarn.lock");
  writeFileSync(lock, "lock");
  const project = { dir, manager: "yarn", lock } as const;
  const cache = packageCache(project, dir, dir, "Linux-X64", (_bin, args) => {
    if (args[0] === "--version") return "4.5.0";
    if (args[2] === "enableGlobalCache") return "false";
    return ".yarn/cache";
  })!;
  const [legacy, sameTool, legacyPrefix] = cache.restoreKeys.split("\n");
  assert.match(legacy ?? "", /^node-cache-Linux-\w+-yarn-[a-f0-9]{64}$/);
  assert.equal(sameTool, cache.key.slice(0, -64));
  assert.equal(legacyPrefix, `node-cache-Linux-${process.arch}-yarn`);
});

test("Gradle cache covers only the caches and wrapper, keyed by distribution, JDK and dependency files", (t) => {
  const dir = fixture(t);
  const home = join(dir, ".gradle");
  mkdirSync(join(dir, "gradle", "wrapper"), { recursive: true });
  mkdirSync(join(dir, "app", "build"), { recursive: true });
  writeFileSync(join(dir, "gradle", "wrapper", "gradle-wrapper.properties"), "distributionUrl=https\\://services.gradle.org/distributions/gradle-8.12-bin.zip\n");
  const lock = join(dir, "app", "gradle.lockfile");
  writeFileSync(lock, "library:1");
  const cache = (java: string) => gradleCache([join(dir, "app"), dir], home, "Linux-X64", java);
  const first = cache("java 17");
  assert.equal(first?.path, [join(home, "caches"), join(home, "wrapper")].join("\n"));
  assert.match(first?.key ?? "", /^proofed-gradle-v1-Linux-X64-8\.12-java-[a-f0-9]{16}-[a-f0-9]{64}$/);
  assert.notEqual(first?.key, cache("java 21")?.key);
  writeFileSync(join(dir, "app", "build", "generated.gradle"), "ignored build output");
  assert.equal(first?.key, cache("java 17")?.key);
  writeFileSync(lock, "library:2");
  assert.notEqual(first?.key, cache("java 17")?.key);
});

test("check and fixer environment keeps runtime settings and switches auth only for the fixer", () => {
  const source = {
    PROOFED_TARGET: "android", PROOFED_DIR: "subproject", PROOFED_SHA: "head", PROOFED_MODEL: "model",
    PROOFED_CODEX: "true", PROOFED_CLAUDE: "false", LT_ACCESS_KEY: "fake-kane-key",
    GITHUB_TOKEN: "fake-github-key", KANE_CLI_CDP_RETRIES: "17", RUNNER_TEMP: "/tmp/job",
  };
  const check = runtimeEnv("check", source);
  assert.deepEqual(check, {
    PROOFED_TARGET: "android", PROOFED_DIR: "subproject", PROOFED_SHA: "head", PROOFED_MODEL: "model",
    PROOFED_CODEX: "true", PROOFED_CLAUDE: "false", LT_ACCESS_KEY: "fake-kane-key",
    GITHUB_TOKEN: "fake-github-key", RUNNER_TEMP: "/tmp/job", PROOFED_OUT: "/tmp/job/proofed",
    KANE_CLI_CDP_TIMEOUT_MS: "60000", KANE_CLI_CDP_RETRIES: "2", KANE_CLI_USER_AGENT: "github-action",
  });
  const fixer = { ...source, PROOFED_CODEX_HOME: "/tmp/credentials", CODEX_API_KEY: "fake-codex-key" };
  assert.equal(runtimeEnv("check", fixer).CODEX_HOME, undefined);
  for (const entry of ["fix", "generate"] as const) {
    const subscription = runtimeEnv(entry, fixer);
    assert.equal(subscription.CODEX_HOME, fixer.PROOFED_CODEX_HOME);
    assert.equal(subscription.CODEX_API_KEY, undefined);
    const apiKey = runtimeEnv(entry, { ...fixer, PROOFED_CODEX_HOME: "" });
    assert.equal(apiKey.CODEX_API_KEY, fixer.CODEX_API_KEY);
    assert.equal(apiKey.CODEX_HOME, undefined);
  }
  assert.equal(fixer.CODEX_API_KEY, "fake-codex-key");
});

test("the background Codex install returns npm's status when the fixer joins it", async (t) => {
  const dir = fixture(t);
  writeFileSync(join(dir, "pid"), String(process.pid));
  writeFileSync(join(dir, "install.log"), "");
  const done = join(dir, "done.json");
  const joined = waitForCodex(dir);
  writeFileSync(done, JSON.stringify({ code: 17, installed: false, seconds: 1.2 }));
  await assert.rejects(joined, { message: "npm exited with code 17.", exitCode: 17 });
  writeFileSync(done, JSON.stringify({ code: 0, installed: true, seconds: 1.2 }));
  await waitForCodex(dir);
});

test("autofix resolves the original port and checkbox fixes use only same-repo branches", () => {
  assert.equal(appPort("http://localhost:1234"), "1234");
  assert.equal(appPort("https://localhost"), "443");
  assert.equal(appPort("http://localhost"), "80");
  const ref = (name: string, sha: string, repo: string) => ({ ref: name, sha, repo: { full_name: repo } });
  const base = ref("main", "base-sha", "owner/repo");
  assert.deepEqual(fixRefs({ base, head: ref("feature", "head-sha", "owner/repo") }), { base: "base-sha", base_ref: "main", head_ref: "feature" });
  assert.equal(fixRefs({ base, head: ref("feature", "head-sha", "fork/repo") }), undefined);
});
