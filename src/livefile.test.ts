import assert from "node:assert/strict";
import { test } from "node:test";
import { readLive, summarize } from "./livefile.ts";

const base = { run: "1-1", pr: 2, sha: "abc", kind: "check", startedAt: 1, scenarios: [] };

test("readLive keeps only what the dashboard shows, of the expected types", () => {
  const live = readLive({
    ...base,
    runUrl: "https://evil.example/run",
    extra: "<script>",
    scenarios: [
      { id: "a", name: "A", status: "running", steps: [{ n: 1, remark: "x".repeat(500), status: "done" }, { n: "2", remark: "bad", status: "done" }], html: "no" },
      { id: "b", status: "exploded", steps: [] },
    ],
  });
  assert.ok(live);
  assert.equal(live.runUrl, undefined);
  assert.equal("extra" in live, false);
  assert.deepEqual(live.scenarios.map((s) => s.id), ["a"]);
  assert.equal(live.scenarios[0]!.steps.length, 1);
  assert.equal(live.scenarios[0]!.steps[0]!.remark.length, 200);
});

test("readLive refuses a state without a pull request or a run", () => {
  assert.equal(readLive({ ...base, pr: 0 }), undefined);
  assert.equal(readLive({ ...base, run: "" }), undefined);
  assert.equal(readLive("nope"), undefined);
});

test("summarize names the scenario Kane is on and its latest step", () => {
  const live = readLive({
    ...base,
    scenarios: [
      { id: "a", name: "A", status: "passed", steps: [] },
      { id: "b", name: "B", status: "running", steps: [{ n: 1, remark: "Opened the store", status: "done" }, { n: 2, remark: "", status: "running" }] },
    ],
  })!;
  assert.deepEqual(summarize(live), { kind: "check", total: 2, done: 1, scenario: "B", step: "Opened the store" });
});
