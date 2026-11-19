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

test("scenario filenames cannot name the output directory or its parent", () => {
  for (const file of [".md", "..md", "...md"]) {
    assert.throws(() => parseScenario(file, "---\nname: unsafe\n---\nOpen the app."), /unsafe scenario id/);
  }
});

test("a scenario can give Kane more time", () => {
  assert.equal(parseScenario("long.md", "---\ntimeout_minutes: 10\n---\nOpen the app.").timeoutMinutes, 10);
  assert.equal(parseScenario("short.md", "---\nname: short\n---\nOpen the app.").timeoutMinutes, undefined);
  assert.throws(() => parseScenario("bad.md", "---\ntimeout_minutes: 90\n---\nOpen the app."), /timeout_minutes/);
});
