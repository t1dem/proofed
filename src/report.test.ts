import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport, fixRequested, readReportData } from "./report.ts";
import type { ScenarioResult } from "./run.ts";

const failed: ScenarioResult = {
  scenario: { id: "promo", file: "promo.md", name: "Promo", paths: [], url: "/", objective: "Total is €81.90 -- after the code" },
  outcome: "failed",
  steps: [],
  end: { type: "run_end", status: "failed", reason: "Total shows €91.00, not €81.90." },
  clip: undefined,
};

test("failure data survives the round trip through the comment", () => {
  const body = buildReport({ sha: "abc1234def", results: [failed], skipped: [], clips: new Map(), fixEnabled: true });
  const data = readReportData(body);
  assert.equal(data?.failures[0]?.objective, "Total is €81.90 -- after the code");
  assert.equal(fixRequested(body), false);
  assert.equal(fixRequested(body.replace("- [ ] **Fix", "- [x] **Fix")), true);
  assert.match(body, /\/proofed fix<\/code> has Claude fix it/);
});

test("the report names the model that fixed it", () => {
  const passed: ScenarioResult = { ...failed, outcome: "passed", end: { type: "run_end", status: "passed", reason: "" } };
  const body = buildReport({
    sha: "abc1234def", results: [passed], skipped: [], clips: new Map(), fixEnabled: true,
    fix: { status: "fixed", attempts: 1, summary: "Prices are in cents.", model: "claude-haiku-5-5", effort: "high", commit: "9f8e7d6c5b" },
  });
  assert.match(body, /by Claude Haiku 5\.5 \(`claude-haiku-5-5`, high effort\) after 1 attempt/);
  assert.doesNotMatch(body, /\/proofed fix/);
});
