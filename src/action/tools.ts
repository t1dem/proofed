import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { configuredFixer } from "../agent.ts";
import { env } from "../env.ts";
import { timedAsync } from "../timing.ts";
import { findOnPath, pathValue } from "../which.ts";
import { actionError, capture, output, quiet, runBash, runnerFile } from "./command.ts";

export const CODEX_VERSION = "0.169.0";
const FFMPEG_RELEASE = "b6.1.1";
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;

const ffmpegSums = {
  x64: "bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa",
  arm64: "754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0",
};

export function ffmpegBuild(os: string, arch: string, root: string) {
  if (os !== "Linux" || (arch !== "X64" && arch !== "ARM64")) return undefined;
  const cpu = arch === "X64" ? "x64" : "arm64";
  return {
    dir: join(root, "proofed-ffmpeg"),
    key: `proofed-ffmpeg-${FFMPEG_RELEASE}-Linux-${cpu}`,
    legacy: `proofed-ffmpeg-${FFMPEG_RELEASE}-${cpu}`,
    url: `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_RELEASE}/ffmpeg-linux-${cpu}.gz`,
    sha256: ffmpegSums[cpu],
  };
}

export function toolPlan(env: NodeJS.ProcessEnv, provider?: string) {
  const legacyFix = env.PROOFED_LEGACY_FIX === "true";
  const syncProvider = legacyFix || env.PROOFED_MODE === "fix" || env.PROOFED_GENERATE === "true" ? provider : undefined;
  const background = !syncProvider && env.PROOFED_AUTOFIX === "true" && provider === "codex";
  const os = env.RUNNER_OS ?? process.platform;
  const arch = env.RUNNER_ARCH ?? process.arch;
  const root = env.RUNNER_TEMP || "";
  const version = env.PROOFED_KANE_VERSION ?? "";
  const kaneKey = EXACT_VERSION.test(version) ? `proofed-cli-v1-kane-${version}-${os}-${arch}` : undefined;
  const codexKey = (syncProvider === "codex" || background) ? `proofed-cli-v1-codex-${CODEX_VERSION}-${os}-${arch}` : undefined;
  const ffmpeg = !legacyFix ? ffmpegBuild(os, arch, env.RUNNER_TOOL_CACHE || root) : undefined;
  return { syncProvider, background, kaneKey, codexKey, ffmpeg, root, version };
}

type Tool = { name: string; bin: string; version: string; prefix: string };

function binDir(prefix: string) {
  return process.platform === "win32" ? prefix : join(prefix, "bin");
}

function addPath(path: string) {
  appendFileSync(env("GITHUB_PATH"), `${path}\n`);
}

function installed(tool: Tool) {
  if (!tool.prefix || !tool.version) return false;
  const modules = process.platform === "win32" ? "node_modules" : "lib/node_modules";
  try {
    if (readFileSync(join(tool.prefix, ".proofed-installed"), "utf8") !== tool.version) return false;
    const manifest = JSON.parse(readFileSync(join(tool.prefix, modules, tool.name, "package.json"), "utf8")) as { version?: string };
    return manifest.version === tool.version && !!findOnPath(join(binDir(tool.prefix), tool.bin));
  } catch {
    return false;
  }
}

async function install(tool: Tool) {
  if (installed(tool)) return false;
  rmSync(tool.prefix, { recursive: true, force: true });
  mkdirSync(tool.prefix, { recursive: true });
  await runBash("npm", ["install", "-g", "--prefix", tool.prefix, `${tool.name}@${tool.version}`], { stdio: quiet });
  writeFileSync(join(tool.prefix, ".proofed-installed"), tool.version);
  return true;
}

function codex(prefix: string): Tool {
  return { name: "@openai/codex", bin: "codex", version: CODEX_VERSION, prefix };
}

export function hasCodex(prefix: string) {
  return installed(codex(prefix));
}

export async function installCodex(prefix: string) {
  return install(codex(prefix));
}

export function useCodex(prefix: string) {
  addPath(binDir(prefix));
}

export async function installClaude() {
  await runBash("npm", ["install", "-g", "@anthropic-ai/claude-code"], { stdio: quiet });
}

async function installFfmpeg(staticBuild: ReturnType<typeof ffmpegBuild>) {
  if (staticBuild) {
    const { dir, url, sha256 } = staticBuild;
    const bin = join(dir, "ffmpeg");
    if (!findOnPath(bin)) {
      try {
        mkdirSync(dir, { recursive: true });
        const archive = join(dir, "ffmpeg.gz");
        await runBash("curl", ["-fsSL", "--retry", "2", "-o", archive, url]);
        if (createHash("sha256").update(readFileSync(archive)).digest("hex") !== sha256) throw new Error("Static ffmpeg checksum mismatch.");
        await runBash("gunzip", ["-f", archive]);
        chmodSync(bin, 0o755);
        if (!capture(bin, ["-version"])) throw new Error("Static ffmpeg failed its version check.");
      } catch {
        console.log("Couldn't get the static ffmpeg; installing it with apt-get");
        rmSync(dir, { recursive: true, force: true });
      }
    }
    const version = capture(bin, ["-version"]);
    if (version) {
      addPath(dir);
      console.log(version.split(/\r?\n/)[0]);
      return true;
    }
  }
  if (findOnPath("ffmpeg")) return false;
  switch (process.env.RUNNER_OS) {
    case "macOS": await runBash("brew", ["install", "ffmpeg"]); break;
    case "Windows": await runBash("choco", ["install", "ffmpeg", "-y", "--no-progress"]); break;
    default:
      await runBash("sudo", ["apt-get", "update", "-qq"]);
      await runBash("sudo", ["apt-get", "install", "-y", "-qq", "ffmpeg"], { stdio: quiet });
  }
  return false;
}

function selectTools() {
  const provider = process.env.PROOFED_LEGACY_FIX === "true" ? configuredFixer().provider : process.env.PROOFED_PROVIDER;
  const plan = toolPlan(process.env, provider);
  const { kaneKey, codexKey, ffmpeg } = plan;
  output({
    provider, sync_provider: plan.syncProvider, background: plan.background,
    kane_key: kaneKey, kane_dir: kaneKey ? join(plan.root, kaneKey) : mkdtempSync(runnerFile("proofed-kane-")),
    codex_key: codexKey, codex_dir: codexKey && join(plan.root, codexKey),
    ffmpeg_key: ffmpeg?.key, ffmpeg_dir: ffmpeg?.dir, ffmpeg_legacy: ffmpeg?.legacy,
  });
}

async function installTools() {
  await timedAsync("tool install", async () => {
    const prefix = env("PROOFED_KANE_DIR");
    const version = process.env.PROOFED_KANE_VERSION ?? "";
    const kaneInstalled = await install({ name: "@testmuai/kane-cli", bin: "kane-cli", version, prefix });
    const kaneDir = binDir(prefix);
    addPath(kaneDir);
    output({ kane_installed: kaneInstalled });
    const provider = process.env.PROOFED_SYNC_PROVIDER;
    if (provider === "codex") {
      const codexDir = env("PROOFED_CODEX_DIR");
      output({ codex_installed: await installCodex(codexDir) });
      useCodex(codexDir);
    } else if (provider === "claude") {
      await installClaude();
    }
    const { ffmpeg } = toolPlan(process.env);
    output({ static_ffmpeg: await installFfmpeg(ffmpeg) });
    if (process.env.PROOFED_LEGACY_FIX !== "true") {
      const path = pathValue(process.env, "PATH") ?? "";
      await runBash("kane-cli", ["--version"], { env: { ...process.env, PATH: `${kaneDir}${delimiter}${path}` } });
    }
  });
}

if (import.meta.main) {
  try {
    if (process.argv[2] === "select") selectTools();
    else if (process.argv[2] === "install") await installTools();
    else throw new Error("Unknown action tool step.");
  } catch (e) { actionError(e); }
}
