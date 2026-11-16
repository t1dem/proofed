#!/usr/bin/env node
// `proofed` in a terminal: the PR check (src/cli.ts) for the change on this machine, for a person
// or a coding agent that wants to see a UI change work before calling it done.
import { readFileSync } from "node:fs";
import { parse, UsageError } from "./args.ts";
import { check } from "./check.ts";
import { killChildren, stopChildren } from "./children.ts";
import { doctor } from "./doctor.ts";
import { helpText } from "./help.ts";
import { list } from "./list.ts";

const argv = process.argv.slice(2);
const io = { stdout: process.stdout, stderr: process.stderr, env: process.env, cwd: process.cwd() };

// Whatever ends the process, nothing it started keeps running, and the cursor comes back.
process.on("exit", () => {
  killChildren();
  if (process.stdout.isTTY) process.stdout.write("\x1b[?25h");
});

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parse(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    if (argv.includes("--json")) {
      io.stdout.write(`${JSON.stringify({ ok: false, exitCode: 3, error: { code: "usage", message: e.message, fix: "See proofed --help." } }, null, 2)}\n`);
    } else {
      io.stderr.write(`proofed: ${e.message}\n`);
    }
    return 3;
  }
  if (parsed.kind === "version") {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    io.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  if (parsed.kind === "help") {
    io.stdout.write(`${helpText(parsed.command)}\n`);
    return 0;
  }
  const { command, flags, text } = parsed;
  if (flags.help) {
    io.stdout.write(`${helpText(command)}\n`);
    return 0;
  }
  if (command === "check") return check(flags, text, io);
  if (command === "list") return list(flags, io);
  return doctor(flags, io);
}

const code = await main();
// A closed Chrome may still be shutting down; its profile folder is removed once it has exited.
await stopChildren();
// Exit once stdout has drained: a pipe may still hold the end of the JSON.
process.stdout.write("", () => process.exit(code));
