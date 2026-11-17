import type { Target, TargetFields } from "./target.ts";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, matchesGlob } from "node:path";

export type Scenario = TargetFields & {
  resolvedTarget?: Target;
  id: string;
  file: string;
  name: string;
  paths: string[];
  url: string;
  objective: string;
};

export function checkScenarioId(id: string) {
  if (!id || id === "." || id === ".." || /[/\\\0]/.test(id)) throw new Error("unsafe scenario id");
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
    if (kv) meta.set(kv[1]!, kv[2]!.trim().replace(/^(["'])(.*)\1$/, "$2"));
  }
  const list = (raw = "") =>
    raw
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);

  const id = basename(file, ".md");
  checkScenarioId(id);
  const objective = body.trim();
  if (!objective) throw new Error(`${file}: empty objective`);
  return {
    ...Object.fromEntries([...meta].filter(([key]) => ["target", "execution", "app", "device", "os_version", "launch", "cdp_endpoint"].includes(key))),
    id,
    file,
    name: meta.get("name") ?? id,
    paths: list(meta.get("paths")),
    url: meta.get("url") ?? "/",
    objective,
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
    const file = join(dir, f);
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
  try {
    return git("ls-tree", "--name-only", rev, `${dir.replace(/\/$/, "")}/`)
      .split("\n")
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => parseScenario(f, git("show", `${rev}:${f}`)));
  } catch {
    return [];
  }
}

export const touches = (s: Scenario, file: string) => file === s.file || s.paths.some((glob) => matchesGlob(file, glob));

// A scenario runs when the diff touches one of its paths, or the scenario file itself.
// No `paths` means "always run".
export function affectedBy(scenarios: Scenario[], changed: string[]) {
  return scenarios.filter((s) => s.paths.length === 0 || changed.some((file) => touches(s, file)));
}
