import assert from "node:assert/strict";
import { test } from "node:test";
import type { Scenario } from "../scenarios.ts";
import { fixLoop, type FixLoopInput } from "./fixloop.ts";

const scenarios: Scenario[] = ["Cart", "Checkout"].map((name) => ({
  id: name.toLowerCase(), file: `${name}.md`, name, paths: [], url: "/", objective: `Check ${name}.`,
}));
const options: FixLoopInput = {
  fixer: { model: "claude-test", effort: "low" },
  failures: scenarios.map((s) => ({ ...s, reason: "It broke.", diagnosis: "", steps: [] })),
  open: scenarios.map((s) => s.id), checked: scenarios.map((s) => s.id),
  ask: () => ({ ok: true, summary: "Fix the cart" }),
  putBack: () => [], hasChanges: () => true, build: () => undefined,
  changedFiles: () => ["cart.js"], allScenarios: () => scenarios, scenariosFor: () => scenarios,
  check: async () => [], maxAttempts: 1,
};

test("the retry identifies a missing scenario result without treating it as a failed check", async () => {
  const asks: { ids: string[]; feedback: string }[] = [];
  const end = await fixLoop({
    ...options,
    maxAttempts: 2,
    ask: (failures, feedback) => {
      asks.push({ ids: failures.map((f) => f.id), feedback });
      return { ok: true, summary: "Fix checkout" };
    },
    check: async () => [{ scenario: scenarios[0]!, outcome: "passed", steps: [], end: undefined, clip: undefined }],
  });
  assert.equal(end.status, "gave-up");
  assert.equal(end.failureStage, "check");
  assert.match(end.feedback, /Kane returned no result for "Checkout"/);
  assert.doesNotMatch(end.feedback, /pass now|still fails/);
  assert.match(end.tries[0]!.result, /Kane returned no result for "Checkout"/);
  assert.deepEqual(asks.map((ask) => ask.ids), [["cart", "checkout"], ["checkout"]]);
  assert.match(asks[1]!.feedback, /Kane returned no result for "Checkout"/);
});

test("a previously unconfirmed neighbour that now fails blocks a fix", async () => {
  const end = await fixLoop({
    ...options,
    failures: [options.failures[0]!],
    scenariosFor: () => [scenarios[0]!],
    check: async (selected) => selected.map((scenario) => ({
      scenario, outcome: scenario.id === "cart" ? "passed" : "failed", steps: [], end: undefined, clip: undefined,
    })),
  });
  assert.equal(end.status, "gave-up");
  assert.deepEqual(end.broke.map((r) => r.scenario.id), ["checkout"]);
});

test("build diagnostics are masked before trimming and check failures keep their own stage", async (t) => {
  const token = "fake-proofed-credential";
  const previous = process.env.GITHUB_TOKEN;
  t.after(() => { if (previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous; });
  process.env.GITHUB_TOKEN = token;
  const built = await fixLoop({ ...options, build: () => `${token}${" ".repeat(2985)}Build failed` });
  assert.equal(built.failureStage, "build");
  assert.match(built.feedback, /\*\*\* .*Build failed$/);
  const checked = await fixLoop({ ...options, check: async () => { throw new Error("Server stuck"); } });
  assert.equal(checked.failureStage, "check");
  assert.match(checked.feedback, /rebuild couldn't be checked.*Server stuck/);
});
