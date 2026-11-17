import { fileURLToPath } from "node:url";
// The fix loop (fixloop.ts) with the fake Kane (src/testing/fake-kane.ts) and real Chrome, against a
// tiny page. Claude is a function here: what it "changes" is what the fake Kane sees on the next run.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findChrome } from "./chrome.ts";
import { fixLoop, type FixLoopInput } from "./fixloop.ts";
import { runAll } from "./pipeline.ts";
import type { FailureData } from "./report.ts";
import type { Scenario } from "./scenarios.ts";

const FAKE_KANE = fileURLToPath(new URL("./testing/fake-kane.ts", import.meta.url));
const noChrome = findChrome() ? false : "Chrome not found; set CHROME_PATH to run the end-to-end tests";

const scenario = (id: string, paths: string[]): Scenario => ({
  id,
  file: `.proofed/scenarios/${id}.md`,
  name: `Scenario ${id}`,
  paths,
  url: "/",
  objective: `Check the page. [fake-from:${id}] [delay:20]`,
});
const failure = (s: Scenario): FailureData => ({ id: s.id, name: s.name, file: s.file, objective: s.objective, reason: "It broke.", diagnosis: "", steps: [] });

const shipping = scenario("shipping", ["src/pricing.js"]);
const promo = scenario("promo", ["src/pricing.js"]);
const checkout = scenario("checkout", ["src/pricing.js"]);
const elsewhere = scenario("elsewhere", ["src/other.js"]);
const all = [shipping, promo, checkout, elsewhere];

type Ask = { failures: string[]; feedback: string };

async function setup(t: { after: (fn: () => unknown) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "proofed-fixloop-"));
  const modes = join(dir, "modes");
  mkdirSync(modes);
  const server = createServer((_, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><title>Shop</title><h1>Shop</h1>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const saved = { ...process.env };
  Object.assign(process.env, {
    KANE_CLI: FAKE_KANE,
    FAKE_KANE_LOG: join(dir, "kane.ndjson"),
    FAKE_KANE_MODES: modes,
    PROOFED_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  });
  t.after(() => {
    process.env = saved;
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const set = (outcomes: Record<string, string>) => {
    for (const [id, mode] of Object.entries(outcomes)) writeFileSync(join(modes, id), mode);
  };
  const asks: Ask[] = [];
  // Each answer of the fake Claude is the outcomes its change leads to, in order.
  const claude = (...rounds: Record<string, string>[]): FixLoopInput["ask"] => (failures, feedback) => {
    asks.push({ failures: failures.map((f) => f.id), feedback });
    set(rounds[asks.length - 1] ?? {});
    return { ok: true, summary: `attempt ${asks.length}` };
  };
  const input = (o: Pick<FixLoopInput, "ask" | "failures" | "open"> & Partial<FixLoopInput>): FixLoopInput => ({
    fixer: { model: "claude-test", effort: "high" },
    checked: ["shipping", "promo", "checkout"],
    putBack: () => [],
    hasChanges: () => true,
    build: () => undefined,
    changedFiles: () => ["src/pricing.js"],
    allScenarios: () => all,
    scenariosFor: (ids) => all.filter((s) => ids.includes(s.id)),
    check: (scenarios, attempt) => runAll(scenarios, join(dir, `attempt-${attempt}`)),
    ...o,
  });
  return { set, asks, claude, input };
}

const ids = (results: { scenario: Scenario }[]) => results.map((r) => r.scenario.id).sort();

test("a fix that breaks a scenario that passed isn't taken; Claude hears which and tries again", { skip: noChrome }, async (t) => {
  const { set, asks, claude, input } = await setup(t);
  set({ shipping: "fail", promo: "pass", checkout: "pass" });
  const end = await fixLoop(
    input({ failures: [failure(shipping)], open: ["shipping"], ask: claude({ shipping: "pass", promo: "fail" }, { promo: "pass" }) }),
  );

  assert.equal(end.status, "fixed");
  assert.equal(end.attempt, 2);
  // The first attempt's check ran the neighbours its change touches, and not the scenario it doesn't.
  assert.deepEqual(ids(end.results), ["checkout", "promo", "shipping"]);
  assert.match(end.tries[0]!.result, /It broke "Scenario promo", which passed before\./);
  assert.equal(end.tries[1]!.result, "Kane saw it pass.");
  assert.deepEqual(asks[1]!.failures, ["shipping"]);
  assert.match(asks[1]!.feedback, /The scenarios you were fixing pass now in Chrome\. Keep that\./);
  assert.match(asks[1]!.feedback, /"Scenario promo" passed before your change and fails now: .* It covers src\/pricing\.js, which you changed\./);
});

test("out of attempts, a fix that only breaks a neighbour gives up with what it broke", { skip: noChrome }, async (t) => {
  const { set, claude, input } = await setup(t);
  set({ shipping: "fail", promo: "pass", checkout: "pass" });
  const end = await fixLoop(
    input({ failures: [failure(shipping)], open: ["shipping"], maxAttempts: 1, ask: claude({ shipping: "pass", promo: "fail" }) }),
  );

  assert.equal(end.status, "gave-up");
  assert.deepEqual(ids(end.fixing), ["shipping"]);
  assert.equal(end.fixing[0]!.outcome, "passed");
  assert.deepEqual(ids(end.broke), ["promo"]);
});

test("a neighbour that was failing already, or that Kane can't confirm, doesn't hold the fix back", { skip: noChrome }, async (t) => {
  const { set, claude, input } = await setup(t);
  set({ shipping: "fail", promo: "fail", checkout: "pass" });
  const end = await fixLoop(
    input({ failures: [failure(shipping)], open: ["shipping", "promo"], ask: claude({ shipping: "pass", checkout: "automation" }) }),
  );

  assert.equal(end.status, "fixed");
  assert.equal(end.attempt, 1);
  assert.deepEqual(end.broke, []);
  assert.equal(end.results.find((r) => r.scenario.id === "promo")?.outcome, "failed");
  assert.equal(end.results.find((r) => r.scenario.id === "checkout")?.outcome, "unsure");
});

test("a scenario an earlier attempt fixed is checked again, and breaking it again is still a failure", { skip: noChrome }, async (t) => {
  const { set, asks, claude, input } = await setup(t);
  const a = scenario("a", ["src/a.js"]);
  const b = scenario("b", ["src/b.js"]);
  set({ a: "fail", b: "fail" });
  const end = await fixLoop(
    input({
      failures: [failure(a), failure(b)],
      open: ["a", "b"],
      changedFiles: () => ["src/b.js"],
      allScenarios: () => [a, b],
      scenariosFor: (wanted) => [a, b].filter((s) => wanted.includes(s.id)),
      ask: claude({ a: "pass" }, { a: "fail", b: "pass" }, { a: "pass" }),
    }),
  );

  assert.equal(end.status, "fixed");
  assert.equal(end.attempt, 3);
  assert.deepEqual(asks.map((x) => x.failures), [["a", "b"], ["b"], ["a"]]);
});

test("a mixed web and Android fix builds once and sends both targets through runAll", { skip: noChrome }, async (t) => {
  const { input, set } = await setup(t);
  set({ shipping: "pass", android: "pass" });
  const app = join(tmpdir(), `proofed-mixed-${process.pid}.apk`);
  writeFileSync(app, "old artifact");
  t.after(() => rmSync(app, { force: true }));
  process.env.PROOFED_FIX = "true";
  const mobile = { ...scenario("android", ["src/pricing.js"]), target: "android", execution: "cloud", app };
  let builds = 0;
  const end = await fixLoop(input({
    failures: [failure(shipping), failure(mobile)], open: [shipping.id, mobile.id],
    ask: () => ({ ok: true, summary: "Fix shared pricing" }),
    allScenarios: () => [shipping, mobile], scenariosFor: () => [shipping, mobile],
    build: () => { builds++; writeFileSync(app, "rebuilt artifact"); return undefined; },
  }));
  assert.equal(end.status, "fixed");
  assert.equal(builds, 1);
  assert.deepEqual(ids(end.results), ["android", "shipping"]);
  assert.ok(end.results.every((r) => r.outcome === "passed"));
});
