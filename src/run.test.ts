import assert from "node:assert/strict";
import { test } from "node:test";
import { focusWords, kaneObjective } from "./run.ts";

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
