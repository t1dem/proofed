import assert from "node:assert/strict";
import { test } from "node:test";
import { creditSummary, defaultScenario, fixedSummary, latestScenarios } from "../src/run-summary.ts";
import type { Run } from "../src/worker/runs.ts";

const before: Run = {
  key: "pr-14/before", sha: "before", at: 1,
  scenarios: [
    { id: "checkout", name: "Place an order", outcome: "unsure", credits: 42.7548575 },
    { id: "free-shipping", name: "Free shipping from €50", outcome: "passed", credits: 25.6132325 },
    { id: "promo-code", name: "Promo code total", outcome: "failed", credits: 22.5274325 },
  ],
};
const after: Run = {
  key: "pr-14/after", sha: "after", at: 2,
  scenarios: [
    { id: "checkout", name: "Place an order", outcome: "unsure", credits: 20.695115 },
    { id: "free-shipping", name: "Free shipping from €50", outcome: "passed", credits: 22.9715135 },
    { id: "promo-code", name: "Promo code total", outcome: "passed", credits: 18.25374 },
  ],
  fix: { status: "fixed", model: "claude-haiku-5-5", effort: "xhigh", summary: "Accept lowercase promo codes." },
};

test("a mixed fixed report opens the repaired flow and keeps explicit scenario links", () => {
  assert.equal(defaultScenario([after, before])?.id, "promo-code");
  assert.equal(defaultScenario([after, before], "Place an order")?.id, "checkout");
  assert.equal(fixedSummary([after, before], "Claude"), "Promo code total fixed; Place an order unconfirmed");
  assert.equal(defaultScenario([before])?.id, "checkout");
});

test("latest verdicts survive an older failure and a partial recheck", () => {
  const partial = { ...after, scenarios: [after.scenarios[2]!] };
  assert.deepEqual(latestScenarios([partial, before]).map((s) => [s.id, s.outcome]), [
    ["promo-code", "passed"], ["checkout", "unsure"], ["free-shipping", "passed"],
  ]);
  assert.equal(defaultScenario([partial, before])?.id, "promo-code");
  assert.equal(fixedSummary([partial, before], "Claude"), "Promo code total fixed; Place an order unconfirmed");
});

test("fully confirmed fixes keep the confirmed wording; failures and errors stay explicit", () => {
  const confirmed: Run = { ...after, scenarios: after.scenarios.map((s) => ({ ...s, outcome: "passed" })) };
  assert.equal(fixedSummary([confirmed, before], "Codex"), "Codex fixed it, Kane confirmed");
  const broken: Run = { ...after, scenarios: [{ ...after.scenarios[0]!, outcome: "failed" }, { id: "new", name: "New flow", outcome: "error" }, after.scenarios[2]!] };
  assert.equal(fixedSummary([broken, before], "Claude"), "Promo code total fixed; Place an order still broken; New flow unfinished");
  assert.equal(defaultScenario([]), undefined);
});

test("credits sum the initial and fixed phases once, including an earlier selected report", () => {
  assert.equal(creditSummary([after, before]), "153 credits across 2 reports (Kane estimate)");
  assert.equal(creditSummary([after, after, before]), "153 credits across 2 reports (Kane estimate)");
  assert.equal(creditSummary([after]), "62 credits, latest check (Kane estimate)");
  assert.equal(creditSummary([before], false), "91 credits, this check (Kane estimate)");
  assert.equal(creditSummary([]), undefined);
  const unknown: Run = { ...after, scenarios: after.scenarios.map(({ credits, ...s }) => s) };
  assert.equal(creditSummary([unknown, before]), "91 credits in earlier reports (Kane estimate)");
  assert.equal(creditSummary([unknown]), undefined);
});
