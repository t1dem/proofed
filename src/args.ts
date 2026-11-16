import { parseArgs } from "node:util";

// A mistake in how proofed was called. Always one line, with the closest valid alternative.
export class UsageError extends Error {}

const COMMON = {
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  scenarios: { type: "string" },
  out: { type: "string" },
} as const;

const APP = {
  url: { type: "string" },
  serve: { type: "string" },
  build: { type: "string" },
} as const;

export const FLAGS = {
  check: {
    ...COMMON,
    ...APP,
    base: { type: "string" },
    only: { type: "string" },
    all: { type: "boolean" },
    "dry-run": { type: "boolean" },
    "no-cache": { type: "boolean" },
    headed: { type: "boolean" },
    reuse: { type: "boolean" },
    concurrency: { type: "string" },
    "serve-timeout": { type: "string" },
    verbose: { type: "boolean" },
  },
  list: { ...COMMON, base: { type: "string" }, url: { type: "string" } },
  doctor: { ...COMMON, ...APP },
} as const;

export type Command = keyof typeof FLAGS;
export const COMMANDS = Object.keys(FLAGS) as Command[];
const isCommand = (word: string): word is Command => Object.hasOwn(FLAGS, word);

export type Flags = {
  json: boolean;
  help: boolean;
  scenarios?: string;
  out?: string;
  url?: string;
  serve?: string;
  build?: string;
  base?: string;
  only?: string[];
  all: boolean;
  dryRun: boolean;
  noCache: boolean;
  headed: boolean;
  reuse: boolean;
  verbose: boolean;
  concurrency?: number;
  serveTimeout?: number;
};

export type Parsed =
  | { kind: "help"; command?: Command }
  | { kind: "version" }
  | { kind: "run"; command: Command; flags: Flags; text?: string };

// Edit distance, for "did you mean".
function distance(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length]!;
}

export const closest = (word: string, options: readonly string[]) =>
  options.reduce((best, o) => (distance(word, o) < distance(word, best) ? o : best), options[0]!);

const flagNames = (command: Command) => Object.keys(FLAGS[command]).map((name) => `--${name}`);

function unknownCommand(word: string) {
  return new UsageError(`Unknown command "${word}". Did you mean: proofed ${closest(word, COMMANDS)}?`);
}

export function parse(argv: string[]): Parsed {
  const [first, ...rest] = argv;
  if (first === undefined || first === "--help" || first === "-h") return { kind: "help" };
  if (first === "--version" || first === "-v" || first === "-V") return { kind: "version" };
  if (first === "help") {
    const topic = rest[0];
    if (topic === undefined) return { kind: "help" };
    if (isCommand(topic)) return { kind: "help", command: topic };
    throw unknownCommand(topic);
  }
  if (first.startsWith("-")) {
    const name = first.split("=")[0]!;
    if (flagNames("check").includes(name)) throw new UsageError(`Flags go after the command: proofed check ${first}`);
    throw new UsageError(`Unknown flag ${first}. Did you mean: proofed ${closest(name, ["--help", "--version"])}?`);
  }
  if (!isCommand(first)) throw unknownCommand(first);
  return { kind: "run", command: first, ...parseFlags(first, rest) };
}

function parseFlags(command: Command, args: string[]) {
  const spec: Record<string, { type: "string" | "boolean" }> = FLAGS[command];
  const { values, tokens } = parseArgs({ args, options: FLAGS[command], strict: false, allowPositionals: true, tokens: true });
  const positionals: string[] = [];
  for (const t of tokens) {
    if (t.kind === "positional") positionals.push(t.value);
    if (t.kind !== "option") continue;
    const type = spec[t.name]?.type;
    if (!type) {
      const known = flagNames(command);
      const elsewhere = COMMANDS.filter((c) => c !== command && flagNames(c).includes(t.rawName));
      throw new UsageError(
        elsewhere.length
          ? `proofed ${command} has no ${t.rawName}; it belongs to proofed ${elsewhere[0]}.`
          : `Unknown flag ${t.rawName} for proofed ${command}. Did you mean: ${closest(t.rawName, known)}?`,
      );
    }
    if (type === "string" && (t.value === undefined || (t.inlineValue !== true && t.value.startsWith("--")))) {
      throw new UsageError(`${t.rawName} needs a value, e.g. ${t.rawName} ${EXAMPLES[t.name] ?? "<value>"}`);
    }
    if (type === "boolean" && t.inlineValue) throw new UsageError(`${t.rawName} takes no value.`);
  }

  const str = (name: string) => {
    const v = values[name];
    return typeof v === "string" ? v.trim() : undefined;
  };
  const on = (name: string) => values[name] === true;
  const count = (name: string) => {
    const raw = str(name);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) throw new UsageError(`--${name} takes a whole number of 1 or more, not "${raw}".`);
    return n;
  };
  const onlyRaw = str("only");
  const only = onlyRaw?.split(",").map((s) => s.trim()).filter(Boolean);
  if (onlyRaw !== undefined && !only?.length) throw new UsageError("--only needs scenario ids, e.g. --only free-shipping,checkout");

  const flags: Flags = {
    json: on("json"),
    help: on("help"),
    scenarios: str("scenarios"),
    out: str("out"),
    url: str("url"),
    serve: str("serve"),
    build: str("build"),
    base: str("base"),
    only,
    all: on("all"),
    dryRun: on("dry-run"),
    noCache: on("no-cache"),
    headed: on("headed"),
    reuse: on("reuse"),
    verbose: on("verbose"),
    concurrency: count("concurrency"),
    serveTimeout: count("serve-timeout"),
  };
  const text = positionals.join(" ").trim() || undefined;
  if (text && command !== "check") throw new UsageError(`proofed ${command} takes no text. To have Kane check it: proofed check "${text}"`);
  if (flags.only && flags.all) throw new UsageError("Use either --only or --all, not both.");
  if (text && (flags.only || flags.all)) throw new UsageError(`Text runs on its own; drop ${flags.only ? "--only" : "--all"}: proofed check "${text}"`);
  return { flags, text };
}

const EXAMPLES: Record<string, string> = {
  url: "http://localhost:5173",
  serve: '"npm run dev"',
  build: '"npm run build"',
  base: "origin/main",
  only: "free-shipping,checkout",
  out: ".proofed-out",
  scenarios: ".proofed/scenarios",
  concurrency: "3",
  "serve-timeout": "60",
};
