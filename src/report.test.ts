import assert from "node:assert/strict";
import { test } from "node:test";
import { addRun, buildReport, fixRequested, readReportData, type ReportData } from "./report.ts";
import type { ScenarioResult } from "./run.ts";

const failed: ScenarioResult = {
  scenario: { id: "promo", file: "promo.md", name: "Promo", paths: [], url: "/", objective: "Total is €81.90 -- after the code" },
  outcome: "failed",
  steps: [],
  end: { type: "run_end", status: "failed", reason: "Total shows €91.00, not €81.90." },
  clip: undefined,
};
const passed: ScenarioResult = { ...failed, outcome: "passed", end: { type: "run_end", status: "passed", reason: "" } };
const fix = { status: "fixed", attempts: 1, summary: "Prices are in cents.", model: "claude-haiku-5-5", effort: "high", commit: "9f8e7d6c5b" } as const;

test("failure data survives the round trip through the comment", () => {
  const body = buildReport({ sha: "abc1234def", results: [failed], skipped: [], clips: new Map(), fixEnabled: true });
  const data = readReportData(body);
  assert.equal(data?.failures[0]?.objective, "Total is €81.90 -- after the code");
  assert.equal(fixRequested(body), false);
  assert.equal(fixRequested(body.replace("- [ ] **Fix", "- [x] **Fix")), true);
  assert.match(body, /<code>\/proofed fix<\/code>/);
});

test("the report names the model that fixed it", () => {
  const body = buildReport({ sha: "abc1234def", results: [passed], skipped: [], clips: new Map(), fixEnabled: true, fix });
  assert.match(body, /by Claude Haiku 5\.5 \(`claude-haiku-5-5`, high effort\) after 1 attempt/);
  assert.doesNotMatch(body, /\/proofed fix/);
});

test("after a fix, the failing report and the passing run make a before/after", () => {
  const raw = "https://github.com/o/r/raw/proofed-clips/pr-1";
  const failing = buildReport({
    sha: "1111111aaaa", results: [failed], skipped: [], fixEnabled: true,
    clips: new Map([["promo", { gif: `${raw}/a/promo.gif`, mp4: `${raw}/a/promo.mp4`, jpg: `${raw}/a/promo.jpg` }]]),
  });
  const after = { ...passed, end: { type: "run_end", status: "passed", summary: "The total is €81.90." } } satisfies ScenarioResult;
  const body = buildReport({
    sha: "9f8e7d6c5b", results: [after], skipped: [], fixEnabled: true, previous: readReportData(failing),
    clips: new Map([["promo", { gif: `${raw}/b/promo.gif`, mp4: `${raw}/b/promo.mp4` }]]),
    fix: { ...fix, changes: [{ file: "src/pricing.ts", added: 3, removed: 1 }] },
  });
  assert.match(body, /#### ✓ Promo: fixed in `9f8e7d6`\n\n\| Before · `1111111` \| After · `9f8e7d6` \|/);
  // The old run has a still; the new one only a GIF, which stands in for it.
  assert.match(body, /\| <a href="[^"]+\/a\/promo\.mp4"><img src="[^"]+\/a\/promo\.jpg" width="360"[^|]+\| <a href="[^"]+\/b\/promo\.mp4"><img src="[^"]+\/b\/promo\.gif" width="360"/);
  assert.match(body, /\| ✗ Total shows €91\.00, not €81\.90\. \| ✓ The total is €81\.90\. \|/);
  assert.match(body, /\*\*What changed:\*\* `src\/pricing\.ts` \(\+3 −1\)\. Prices are in cents\./);
  assert.doesNotMatch(body, /Passed:/);
  assert.deepEqual(readReportData(body)?.history, [{ sha: "1111111aaaa", state: "failed" }, { sha: "9f8e7d6c5b", state: "fixed" }]);
  assert.match(body, /1111111 ✗ → 9f8e7d6 ✓ fixed/);
});

test("data from a report written before clips and history were kept still makes a report", () => {
  const old = buildReport({ sha: "1111111aaaa", results: [failed], skipped: [], clips: new Map(), fixEnabled: true })
    .replace(/<!-- proofed:data .* -->/s, `<!-- proofed:data {"sha":"1111111aaaa","failures":[{"id":"promo","name":"Promo","file":"promo.md","objective":"x","reason":"Total shows €91.00.","diagnosis":"","steps":["✗ Total is wrong"]}]} -->`);
  const previous = readReportData(old);
  const body = buildReport({ sha: "9f8e7d6c5b", results: [passed], skipped: [], clips: new Map(), fixEnabled: true, fix, previous });
  assert.match(body, /\| ✗ Total shows €91\.00\. \| ✓ Passes\. \|/);
  assert.doesNotMatch(body, /<img/);
  assert.deepEqual(readReportData(body)?.history, [{ sha: "9f8e7d6c5b", state: "fixed" }]);
  assert.doesNotMatch(body, / → /);
});

test("the run history keeps the last 8 runs, one per commit", () => {
  let history: ReportData["history"] = [];
  for (let i = 0; i < 10; i++) history = addRun(history, { sha: `sha${i}`, state: "failed" });
  history = addRun(history, { sha: "sha9", state: "passed" });
  assert.deepEqual(history.map((h) => h.sha), ["sha2", "sha3", "sha4", "sha5", "sha6", "sha7", "sha8", "sha9"]);
  assert.equal(history.at(-1)?.state, "passed");
});
