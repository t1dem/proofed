import assert from "node:assert/strict";
import { test } from "node:test";
import { tally } from "../src/client/activity.ts";
import type { ActivityRun } from "../src/worker/runs.ts";

const DAY = 86_400_000;
const now = new Date(2026, 10, 20, 15).getTime();
const run = (daysAgo: number, outcomes: ActivityRun["scenarios"][number]["outcome"][], extra: Partial<ActivityRun> = {}): ActivityRun => ({
  repo: "o/shop",
  pr: 1,
  at: now - daysAgo * DAY,
  scenarios: outcomes.map((outcome, i) => ({ name: `S${i}`, outcome, credits: 10, seconds: 60 })),
  ...extra,
});

test("the dashboard counts this period's runs by day and against the period before", () => {
  const t = tally(
    [
      run(0, ["passed", "failed"]),
      run(0, ["passed"], { fix: { status: "fixed", model: "claude-opus-5-5", attempts: 2 }, balance: 900 }),
      run(3, ["unsure"], { balance: 950 }),
      run(8, ["passed"]), // the week before
      run(20, ["failed"]), // older than both weeks
    ],
    7,
    now,
  );
  assert.equal(t.daily.length, 7);
  assert.deepEqual(t.daily.at(-1), { start: new Date(2026, 10, 20).getTime(), passed: 1, broke: 1, unsure: 0, credits: 30 });
  assert.equal(t.daily.at(-4)!.unsure, 1);
  assert.equal(t.runs, 3);
  assert.equal(t.runsBefore, 1);
  assert.equal(t.passRate, 2 / 4);
  assert.equal(t.passRateBefore, 1);
  assert.equal(t.credits, 40);
  assert.equal(t.balance, 900);
  assert.deepEqual(t.fixes, { tried: 1, fixed: 1, gaveUp: 0, attempts: 2, fixedBefore: 0 });
  assert.deepEqual(t.models, [{ model: "claude-opus-5-5", tries: 1, attempts: 2, fixed: 1 }]);
  assert.deepEqual(t.breaking, [{ repo: "o/shop", name: "S1", failed: 1, runs: 1 }]);
});
