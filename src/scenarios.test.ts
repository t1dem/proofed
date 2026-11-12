import assert from "node:assert/strict";
import { test } from "node:test";
import { affectedBy, parseScenario } from "./scenarios.ts";

const promo = parseScenario(
  ".proofed/scenarios/promo-code.md",
  `---
name: Promo code total
paths: [src/pricing.ts, "src/pages/**"]
---
Apply welcome10 and check the total.
`,
);

test("parses frontmatter and objective", () => {
  assert.equal(promo.id, "promo-code");
  assert.deepEqual(promo.paths, ["src/pricing.ts", "src/pages/**"]);
  assert.equal(promo.url, "/");
  assert.equal(promo.objective, "Apply welcome10 and check the total.");
});

test("picks scenarios by diff", () => {
  const always = { ...promo, id: "smoke", file: "smoke.md", paths: [] };
  assert.deepEqual(affectedBy([promo, always], ["README.md"]).map((s) => s.id), ["smoke"]);
  assert.deepEqual(affectedBy([promo], ["src/pages/Cart.tsx"]).map((s) => s.id), ["promo-code"]);
  assert.deepEqual(affectedBy([promo], [".proofed/scenarios/promo-code.md"]).map((s) => s.id), ["promo-code"]);
});
