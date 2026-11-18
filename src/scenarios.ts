import { gitPath, matchesPath } from "./paths.ts";
import type { Target, TargetFields } from "./target.ts";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { posix, join } from "node:path";

export type Scenario = TargetFields & {
  resolvedTarget?: Target;
  id: string;
  file: string;
  name: string;
  paths: string[];
  url: string;
  objective: string;
  // Kane's limit for this scenario. Long native flows need more than the default 5 minutes.
  timeoutMinutes?: number;
};

export function checkScenarioId(id: string, platform = process.platform) {
  if (!id || id === "." || id === ".." || /[/\\\0]/.test(id)) throw new Error("unsafe scenario id");
  if (platform === "win32" && (/[<>:"|?*\x00-\x1f]/.test(id) || /[. ]$/.test(id) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id))) throw new Error("unsafe scenario id on Windows");
}

// A scenario is a Markdown file: a small frontmatter block, then the plain-English objective Kane runs.
//   ---
//   name: Promo code total
//   paths: [src/pricing.ts, src/pages/**]
//   url: /
//   ---
//   Add two bags of Guji, apply welcome10, check the total is €26.10.
export function parseScenario(file: string, text: string): Scenario {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  if (!match) throw new Error(`${file}: missing frontmatter`);
  const [, head = "", body = ""] = match;

  const meta = new Map<string, string>();
  for (const line of head.split("\n")) {
    const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (kv) {
      const raw = kv[2]!.trim();
      const single = /^'((?:[^']|'')*)'$/.exec(raw);
      const double = /^"((?:[^"\\]|\\.)*)"$/.exec(raw);
      meta.set(kv[1]!, single ? single[1]!.replaceAll("''", "'") : double ? JSON.parse(raw) as string : raw);
    }
  }
  const list = (raw = "") =>
    raw
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);

  file = gitPath(file);
  const id = posix.basename(file, ".md");
  checkScenarioId(id);
  const objective = body.trim();
  if (!objective) throw new Error(`${file}: empty objective`);
  const timeout = meta.get("timeout_minutes");
  const timeoutMinutes = timeout === undefined ? undefined : Number(timeout);
  if (timeoutMinutes !== undefined && !(Number.isInteger(timeoutMinutes) && timeoutMinutes >= 1 && timeoutMinutes <= 30)) throw new Error(`${file}: timeout_minutes must be a whole number from 1 to 30`);
  return {
    ...Object.fromEntries([...meta].filter(([key]) => ["target", "execution", "app", "device", "os_version", "launch", "cdp_endpoint"].includes(key))),
    id,
    file,
    name: meta.get("name") ?? id,
    paths: list(meta.get("paths")),
    url: meta.get("url") ?? (meta.has("target") && meta.get("target") !== "web" ? "" : "/"),
    objective,
    ...(timeoutMinutes && { timeoutMinutes }),
  };
}

export function loadScenarios(dir: string) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => parseScenario(join(dir, f), readFileSync(join(dir, f), "utf8")));
}

// Every file that parses, and what's wrong with each one that doesn't: `proofed list` and
// `proofed doctor` show a broken file next to the good ones instead of stopping at it.
export function readScenarios(dir: string) {
  const scenarios: Scenario[] = [];
  const errors: { file: string; message: string }[] = [];
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return { missing: true, scenarios, errors };
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
    const file = gitPath(join(dir, f));
    try {
      scenarios.push(parseScenario(file, readFileSync(file, "utf8")));
    } catch (e) {
      errors.push({ file, message: (e instanceof Error ? e.message : String(e)).replace(`${file}: `, "") });
    }
  }
  return { missing: false, scenarios, errors };
}

// A PR opened before Proofed was added has no scenarios on its branch; they're read from the base
// branch instead (`rev`, e.g. origin/main).
export function loadScenariosOr(dir: string, rev: string | undefined) {
  if (existsSync(dir)) return loadScenarios(dir);
  if (!rev) return [];
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return git("ls-tree", "-z", "--name-only", rev, "--", `${gitPath(dir).replace(/\/$/, "")}/`)
    .split("\0")
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => parseScenario(f, git("show", `${rev}:./${f}`)));
}

export const touches = (s: Scenario, file: string) => gitPath(file) === gitPath(s.file) || s.paths.some((glob) => matchesPath(file, glob));

// A scenario runs when the diff touches one of its paths, or the scenario file itself.
// No `paths` means "always run".
export function affectedBy(scenarios: Scenario[], changed: string[]) {
  return scenarios.filter((s) => s.paths.length === 0 || changed.some((file) => touches(s, file)));
}
