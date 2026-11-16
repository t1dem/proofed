import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

const executable = (file: string) => {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env) {
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const file = join(dir, name);
    if (executable(file)) return file;
  }
  return undefined;
}

// The Kane binary src/kane.ts will spawn: KANE_CLI when set, else kane-cli on PATH.
export function findKane(env: NodeJS.ProcessEnv = process.env): { path?: string; from: string } {
  const own = env.KANE_CLI?.trim();
  if (own) {
    const file = own.includes("/") ? resolve(own) : findOnPath(own, env);
    return { path: file && executable(file) ? file : undefined, from: `KANE_CLI=${own}` };
  }
  return { path: findOnPath("kane-cli", env), from: "PATH" };
}
