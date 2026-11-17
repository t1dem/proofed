import assert from "node:assert/strict";
import { test } from "node:test";
import { parse, UsageError } from "./args.ts";

const usage = (argv: string[]) => {
  try {
    parse(argv);
  } catch (e) {
    assert.ok(e instanceof UsageError);
    return e.message;
  }
  assert.fail(`${argv.join(" ")} parsed`);
};

test("no arguments, --help and help <command> show help; --version the version", () => {
  assert.deepEqual(parse([]), { kind: "help" });
  assert.deepEqual(parse(["--help"]), { kind: "help" });
  assert.deepEqual(parse(["help", "check"]), { kind: "help", command: "check" });
  assert.deepEqual(parse(["--version"]), { kind: "version" });
  const run = parse(["doctor", "-h"]);
  assert.ok(run.kind === "run" && run.flags.help);
});

test("check takes its flags, the text as one string, and --only as ids", () => {
  const p = parse(["check", "the", "promo code", "--url", "http://localhost:5173", "--no-cache", "--concurrency", "2", "--no-retry", "--json"]);
  assert.ok(p.kind === "run");
  assert.equal(p.text, "the promo code");
  assert.equal(p.flags.url, "http://localhost:5173");
  assert.equal(p.flags.noCache, true);
  assert.equal(p.flags.concurrency, 2);
  assert.equal(p.flags.json, true);
  assert.equal(p.flags.noRetry, true);
  const only = parse(["check", "--only=a, b"]);
  assert.ok(only.kind === "run");
  assert.deepEqual(only.flags.only, ["a", "b"]);
});

test("a typo gets the closest command or flag, in one line", () => {
  assert.equal(usage(["chek"]), 'Unknown command "chek". Did you mean: proofed check?');
  assert.equal(usage(["check", "--jsn"]), "Unknown flag --jsn for proofed check. Did you mean: --json?");
  assert.equal(usage(["check", "--dryrun"]), "Unknown flag --dryrun for proofed check. Did you mean: --dry-run?");
  assert.equal(usage(["doctor", "--base", "main"]), "proofed doctor has no --base; it belongs to proofed check.");
  assert.equal(usage(["--all"]), "Flags go after the command: proofed check --all");
  for (const argv of [["chek"], ["check", "--jsn"], ["check", "--url"]]) assert.doesNotMatch(usage(argv), /\n/);
});

test("values and combinations that can't work are refused", () => {
  assert.match(usage(["check", "--url"]), /^--url needs a value, e\.g\. --url http:\/\/localhost:5173$/);
  assert.match(usage(["check", "--url", "--json"]), /--url needs a value/);
  assert.match(usage(["check", "--concurrency", "0"]), /whole number/);
  assert.match(usage(["check", "--all", "--only", "a"]), /either --only or --all/);
  assert.match(usage(["check", "words", "--all"]), /Text runs on its own/);
  assert.match(usage(["list", "words"]), /proofed list takes no text/);
  assert.match(usage(["check", "--json=yes"]), /takes no value/);
});
