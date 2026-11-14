import assert from "node:assert/strict";
import { test } from "node:test";
import { FIRST_SCENARIO, onlyFirstScenario } from "./setup.ts";

test("scenarios are written only while the setup PR's stock scenario is the only one, unchanged", () => {
  assert.equal(onlyFirstScenario([{ name: "home.md", text: FIRST_SCENARIO }]), true);
  assert.equal(onlyFirstScenario([{ name: "home.md", text: FIRST_SCENARIO.replace("main heading", "heading") }]), false);
  assert.equal(onlyFirstScenario([{ name: "home.md", text: FIRST_SCENARIO.trimEnd() }]), false);
  assert.equal(onlyFirstScenario([{ name: "home.md", text: FIRST_SCENARIO }, { name: "cart.md", text: "" }]), false);
  assert.equal(onlyFirstScenario([{ name: "start.md", text: FIRST_SCENARIO }]), false);
  assert.equal(onlyFirstScenario([]), false);
});
