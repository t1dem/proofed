import { accessSync, constants, statSync } from "node:fs";
import { join, resolve, win32 } from "node:path";

const executable = (file: string, platform = process.platform) => {
  try {
    accessSync(file, platform === "win32" ? constants.F_OK : constants.X_OK);
    return statSync(file).isFile();
  } catch { return false; }
};

export const pathValue = (env: NodeJS.ProcessEnv, name: string) =>
  env[name] ?? env[Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase()) ?? name];

export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env, platform = process.platform) {
  const windows = platform === "win32";
  const extensions = windows ? (pathValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [];
  const explicit = /[/\\]/.test(name);
  const suffixes = windows && !extensions.some((ext) => name.toLowerCase().endsWith(ext.toLowerCase()))
    ? explicit || win32.extname(name) ? [...extensions, ""] : extensions
    : [""];
  const dirs = explicit ? [""] : (pathValue(env, "PATH") ?? "").split(windows ? ";" : ":").filter(Boolean);
  for (const dir of dirs) {
    for (const suffix of suffixes) {
      const file = dir ? join(dir.replace(/^"|"$/g, ""), `${name}${suffix}`) : name + suffix;
      if (executable(file, platform)) return resolve(file);
      // Windows filesystems ignore case; this also lets injected-platform tests run on Unix.
      const lower = file.slice(0, file.length - suffix.length) + suffix.toLowerCase();
      if (suffix && executable(lower, platform)) return resolve(lower);
    }
  }
  return undefined;
}

export function findKane(env: NodeJS.ProcessEnv = process.env, platform = process.platform): { path?: string; from: string } {
  const own = env.KANE_CLI?.trim();
  if (own) {
    const file = findOnPath(/[/\\]/.test(own) ? resolve(own) : own, env, platform);
    return { path: file, from: `KANE_CLI=${own}` };
  }
  return { path: findOnPath("kane-cli", env, platform), from: "PATH" };
}
