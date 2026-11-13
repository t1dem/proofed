import assert from "node:assert/strict";
import { test } from "node:test";
import type { Step } from "./kane.ts";
import { focusWords, kaneObjective, outcomeOf } from "./run.ts";

test("a failed check is located by the words of its quoted expectation", () => {
  const words = focusWords({ type: "run_end", status: "failed", reason: "The bag shows “That code doesn’t work,” leaving no discount." });
  assert.deepEqual(words, ["code", "doesn't", "work"]);
});

test("Kane is told not to route around a step that misbehaves", () => {
  const objective = kaneObjective("Open the pause menu and press keep drawing.");
  assert.ok(objective.startsWith("Open the pause menu and press keep drawing.\n\n"));
  assert.match(objective, /check fails: don't retry it, and don't reach the goal another way/);
});

test("a passed run is located by the values Kane read off the page", () => {
  const words = focusWords({ type: "run_end", status: "passed", final_state: { url: "http://localhost/cart", shipping: "Free", total: "€51.00" } });
  assert.deepEqual(words, ["free", "€51.00"]);
});

// Steps and verdicts as Kane reported them on PR #3, after the fix.
const step = (remark: string, status: Step["status"] = "done"): Step => ({ step: 0, status, remark, ts: "" });
const pass = { type: "run_end", status: "passed", reason: "Objective completed" } as const;

test("a pass counts only when Kane asserted something on the page", () => {
  const looked = [step("navigate: Navigate to http://localhost:4173/"), step("wait: Waiting verify the example scenario caption starts with its scenario name")];
  assert.equal(outcomeOf(pass, looked), "unsure");
  const asserted = [...looked, step("analyze: the page shows no error message"), step("assert: the main heading is visible and the page shows no error message")];
  assert.equal(outcomeOf(pass, asserted), "passed");
  assert.equal(outcomeOf({ ...pass, status: "failed", verdict: { family: "application_issue" } }, looked), "failed");
  assert.equal(outcomeOf({ ...pass, status: "failed", verdict: { family: "automation_bug" } }, looked), "unsure");
});
