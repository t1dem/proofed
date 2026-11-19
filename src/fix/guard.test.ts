import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { offLimits } from "./guard.ts";

test("the fixer may change the app, not the scenarios or the workflows", () => {
  const dir = ".proofed/scenarios";
  assert.equal(offLimits("src/pricing.ts", dir), false);
  assert.equal(offLimits(".proofed/scenarios/promo-code.md", dir), true);
  assert.equal(offLimits(".github/workflows/proofed.yml", dir), true);
  // A repo that keeps its scenarios elsewhere, and a folder that only starts with the same letters.
  assert.equal(offLimits("e2e/flows/cart.md", "e2e/flows/"), true);
  assert.equal(offLimits("e2e/flows/cart.md", "./e2e/flows"), true);
  assert.equal(offLimits("e2e/flows/cart.md", resolve("e2e/flows")), true);
  assert.equal(offLimits("e2e/flows-old/cart.md", "e2e/flows/"), false);
});
