import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse, type Command } from "./args.ts";
import { check, type Io } from "./check.ts";
import type { Doc, ErrorDoc } from "../report/result.ts";
import { doctor, type DoctorCheck } from "./doctor.ts";
import { list } from "./list.ts";

test("check, list and doctor select inherited targets before applying overrides", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "proofed-selection-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const scenarios = join(cwd, ".proofed/scenarios");
  mkdirSync(scenarios, { recursive: true });
  writeFileSync(join(scenarios, "web.md"), "---\ntarget: web\n---\nAssert the heading.\n");
  writeFileSync(join(scenarios, "mobile.md"), "---\nexecution: cloud\napp: APP123\n---\nAssert the heading.\n");
  const config = join(cwd, ".proofed/config.json");
  writeFileSync(config, '{"target":"android"}');

  const output: string[] = [];
  const io: Io = { cwd, env: { PATH: "" }, stdout: { write: (data) => output.push(data) }, stderr: { write: () => {} } };
  const flags = (command: Command, ...args: string[]) => {
    const parsed = parse([command, "--json", "--scenarios", scenarios, ...args]);
    assert.equal(parsed.kind, "run");
    return parsed.flags;
  };
  const read = <T>() => JSON.parse(output.pop()!) as T;

  assert.equal(await check(flags("check", "--all", "--dry-run", "--target", "web"), undefined, io), 0);
  const web = read<Doc>();
  assert.deepEqual(web.scenarios.map(({ id }) => id), ["web"]);
  assert.equal(web.skipped[0]?.why, "different target");
  assert.equal(await check(flags("check", "--all", "--dry-run", "--target", "unknown"), undefined, io), 3);
  assert.equal(read<ErrorDoc>().error.code, "target_invalid");

  assert.equal(await check(flags("check", "--only", "mobile", "--dry-run", "--target", "android"), undefined, io), 0);
  assert.deepEqual(read<Doc>().scenarios.map(({ id }) => id), ["mobile"]);

  mkdirSync(join(cwd, ".github/workflows"), { recursive: true });
  writeFileSync(join(cwd, ".github/workflows/check.yml"), "steps:\n  - uses: t1dem/proofed@main\n    with:\n      target: android\n");
  rmSync(config);
  assert.equal(list(flags("list", "--target", "android"), io), 0);
  assert.deepEqual(read<{ scenarios: { id: string }[] }>().scenarios.map(({ id }) => id), ["mobile"]);
  await doctor(flags("doctor", "--target", "android"), io);
  assert.ok(read<{ checks: DoctorCheck[] }>().checks.some(({ name }) => name === "android: App artifact type"));

  writeFileSync(config, "{");
  assert.equal(await doctor(flags("doctor"), io), 3);
  const report = read<{ checks: DoctorCheck[] }>();
  assert.ok(report.checks.some(({ name }) => name === "Kane CLI"));
  assert.match(report.checks.find(({ name }) => name === "Target")?.fix ?? "", /Correct the JSON in .proofed\/config.json/);
});
