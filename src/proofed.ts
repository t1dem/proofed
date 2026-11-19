#!/usr/bin/env node
// `proofed` in a terminal: the PR check (src/action/cli.ts) for the change on this machine, for a person
// or a coding agent that wants to see a UI change work before calling it done.
import { readFileSync } from "node:fs";
import { parse, UsageError } from "./check/args.ts";
import { killChildren, stopChildren } from "./children.ts";
import { helpText } from "./check/help.ts";

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
      io.stdout.write(`${JSON.stringify({ ok: false, exitCode: 3, error: { code: "usage", message: e.message, fix: "See proofed --help." } })}\n`);
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
  if (command === "check") return (await import("./check/check.ts")).check(flags, text, io);
  if (command === "list") return (await import("./check/list.ts")).list(flags, io);
  return (await import("./check/doctor.ts")).doctor(flags, io);
}

// Exit 1 is "a scenario failed", so a crash must not end that way: 3, with the error where the
// caller reads it.
const code = await main().catch((e: unknown) => {
  const message = `Proofed hit an unexpected error: ${e instanceof Error ? e.message : String(e)}`;
  if (argv.includes("--json")) {
    io.stdout.write(`${JSON.stringify({ ok: false, exitCode: 3, error: { code: "internal", message, fix: "Run it again with --verbose; nothing was checked." } })}\n`);
  } else {
    io.stderr.write(`proofed: ${message}\n`);
  }
  return 3;
});
// A closed Chrome may still be shutting down; its profile folder is removed once it has exited.
await stopChildren();
// Exit once stdout has drained: a pipe may still hold the end of the JSON.
process.stdout.write("", () => process.exit(code));
