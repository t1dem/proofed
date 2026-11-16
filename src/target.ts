// Where the app under test is, for `proofed check` and `proofed doctor`: its URL, and the commands
// that build and serve it when it isn't running. Each comes from the first place that has it:
// a flag, the environment, .proofed/config.json, then the Proofed step of the repo's workflow.
// So in a repo that already runs Proofed on its pull requests, `proofed check` needs no flags.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SetupError } from "./setuperror.ts";

export type Setting = { value: string; from: string };
export type Target = { url?: Setting; serve?: Setting; build?: Setting; dir: string };

type Layer = { from: (key: Key) => string; values: Partial<Record<Key, string>>; dir?: string };
type Key = "url" | "serve" | "build";
const KEYS: Key[] = ["url", "serve", "build"];

export const CONFIG_FILE = ".proofed/config.json";

// "localhost:5173" parses as a URL with the scheme "localhost:", so parsing alone isn't the test.
export function isHttpUrl(value: string) {
  try {
    return /^https?:$/.test(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function readConfig(cwd: string): Partial<Record<Key, string>> {
  const file = join(cwd, CONFIG_FILE);
  if (!existsSync(file)) return {};
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new SetupError("config_invalid", `${CONFIG_FILE} is not valid JSON: ${e instanceof Error ? e.message : e}`, `Fix ${CONFIG_FILE}; it holds { "url", "serve", "build" }.`);
  }
  if (typeof data !== "object" || data === null) return {};
  const out: Partial<Record<Key, string>> = {};
  for (const key of KEYS) {
    const v = (data as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim()) out[key] = v.trim();
  }
  return out;
}

const unquote = (v: string) => {
  const q = /^(["'])(.*)\1$/.exec(v);
  return q ? q[2]!.replace(/''/g, "'") : v;
};
// "url: http://localhost:4173 # the preview" without its comment; a # inside quotes stays.
const scalar = (raw: string) => {
  const v = raw.trim();
  if (/^["']/.test(v)) return unquote(v.replace(/^((["']).*?\2)\s*(#.*)?$/, "$1"));
  return v.replace(/\s+#.*$/, "");
};
const indent = (line: string) => line.length - line.trimStart().length;
const blank = (line: string) => line.trim() === "" || line.trim().startsWith("#");

// The `with:` inputs of the first step that uses the Proofed action (t1dem/proofed@…, not /fix).
// A line reader, not YAML: it knows the shape of a step and nothing more. Block scalars (|, >)
// and expressions (${{ … }}) are skipped, since they can't be run outside Actions.
export function workflowInputs(text: string): Record<string, string> | undefined {
  const lines = text.split(/\r?\n/);
  const uses = lines.findIndex((l) => /^\s*(-\s+)?uses:\s*["']?t1dem\/proofed@/.test(l));
  if (uses === -1) return undefined;
  const usesLine = lines[uses]!;
  const keyIndent = usesLine.indexOf("uses:");
  // The step starts at its dash: on the uses line, or on a line above it.
  let start = uses;
  while (start > 0 && !/^\s*-\s/.test(lines[start]!)) start--;
  const dash = indent(lines[start]!);
  let end = uses + 1;
  while (end < lines.length && (blank(lines[end]!) || indent(lines[end]!) > dash)) end++;
  const step = lines.slice(start, end);

  const withAt = step.findIndex((l) => indent(l) === keyIndent && /^\s*with:\s*(#.*)?$/.test(l));
  if (withAt === -1) return {};
  const inputs: Record<string, string> = {};
  for (const line of step.slice(withAt + 1)) {
    if (blank(line)) continue;
    if (indent(line) <= keyIndent) break;
    const kv = /^\s*([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const value = scalar(kv[2]!);
    if (!value || /^[|>]/.test(value) || value.includes("${{")) continue;
    inputs[kv[1]!] = value;
  }
  return inputs;
}

export function readWorkflow(cwd: string): { file: string; inputs: Record<string, string> } | undefined {
  const dir = join(cwd, ".github/workflows");
  if (!existsSync(dir)) return undefined;
  for (const name of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const file = join(".github/workflows", name);
    const inputs = workflowInputs(readFileSync(join(cwd, file), "utf8"));
    if (inputs) return { file, inputs };
  }
  return undefined;
}

type Sources = {
  flags: Partial<Record<Key, string>>;
  env: NodeJS.ProcessEnv;
  cwd: string;
};

export function resolveTarget({ flags, env, cwd }: Sources): Target {
  const workflow = readWorkflow(cwd);
  const layers: Layer[] = [
    { from: (k) => `--${k}`, values: flags },
    { from: (k) => `PROOFED_${k.toUpperCase()}`, values: { url: env.PROOFED_URL?.trim(), serve: env.PROOFED_SERVE?.trim(), build: env.PROOFED_BUILD?.trim() } },
    { from: () => CONFIG_FILE, values: readConfig(cwd) },
    ...(workflow
      ? [{ from: () => workflow.file, values: { url: workflow.inputs.url, serve: workflow.inputs.serve, build: workflow.inputs.build }, dir: workflow.inputs["working-directory"] }]
      : []),
  ];
  const pick = (key: Key, from = layers) => {
    for (const layer of from) {
      const value = layer.values[key];
      if (value) return { setting: { value, from: layer.from(key) }, layer };
    }
    return undefined;
  };
  const url = pick("url");
  const serve = pick("serve");
  // A build belongs with its serve command: the workflow's build is for the workflow's serve. One
  // given as a flag or in the environment applies to whichever serve is used.
  const build = pick("build", layers.slice(0, 2)) ?? (serve && pick("build", [serve.layer]));
  return {
    url: url?.setting,
    serve: serve?.setting,
    build: build?.setting,
    dir: resolve(cwd, serve?.layer.dir ?? "."),
  };
}
