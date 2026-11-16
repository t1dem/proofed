import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDoc, exitCodeOf, rerunCommand, type Item } from "./result.ts";
import { FAILED_CHECK_ACTION, NOTHING_CHECKED } from "./runfile.ts";
import { ran as result, refuted, scenario } from "./testing/results.ts";

const input = (items: Item[]) => ({ items, skipped: [{ id: "checkout", name: "Checkout", why: "the change does not touch its paths" }], base: "origin/main", changedFiles: 2, url: "http://localhost:4173", seconds: 74, out: "/out", rerun: { flags: ["--json"] }, estimatedCredits: 50 });

test("exit codes: 1 for a failure, 2 for not checked or error only, else 0", () => {
  const counts = { passed: 1, failed: 0, not_checked: 0, error: 0, skipped: 4 };
  assert.equal(exitCodeOf(counts), 0);
  assert.equal(exitCodeOf({ ...counts, not_checked: 1 }), 2);
  assert.equal(exitCodeOf({ ...counts, error: 1 }), 2);
  assert.equal(exitCodeOf({ ...counts, failed: 1, error: 1 }), 1);
});

test("a failed scenario carries what Kane saw, its verdict, the failed step and how to re-run it", () => {
  const doc = buildDoc(input([
    result("promo", "passed", { status: "passed", reason: "Objective completed", credits_consumed: 25 }),
    result("free-shipping", "failed", { reason: "Shipping shows Free.", credits_consumed: 27, verdict: { family: "product_bug", root_cause: "The threshold is €40.", suggestion: "Use 50." } }, { name: "Free shipping from €50" }),
  ]));
  assert.equal(doc.ok, false);
  assert.equal(doc.exitCode, 1);
  assert.equal(doc.summary, "1 of 2 broke: Free shipping from €50");
  assert.deepEqual(doc.counts, { passed: 1, failed: 1, not_checked: 0, error: 0, skipped: 1 });
  assert.equal(doc.credits, 52);
  const failed = doc.scenarios[1]!;
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.reason, "Shipping shows Free.");
  assert.equal(failed.diagnosis, "The threshold is €40.");
  assert.equal(failed.suggestion, "Use 50.");
  assert.equal(failed.failedStep, "assert: shipping is €4.90");
  assert.deepEqual(failed.steps.at(-1), { remark: "assert: shipping is €4.90", failed: true });
  assert.deepEqual(failed.clip, { mp4: "/out/x/clip.mp4", jpg: "/out/x/clip.jpg" });
  assert.equal(failed.rerun, "proofed check --only free-shipping --json");
  assert.equal(doc.rerun, "proofed check --only free-shipping --json");
  assert.equal(doc.next, "Fix the failed scenarios, then run: proofed check --only free-shipping --json");
  // A pass carries no diagnosis.
  assert.equal(doc.scenarios[0]!.diagnosis, undefined);
});

test("not checked says which kind it is, and is never a pass", () => {
  const doc = buildDoc(input([
    result("vague", "unsure", { status: "passed", reason: NOTHING_CHECKED }),
    result("wrong", "unsure", { status: "failed", reason: "No such button.", verdict: { family: "automation_bug" } }),
  ]));
  assert.equal(doc.exitCode, 2);
  assert.equal(doc.ok, false);
  assert.deepEqual(doc.scenarios.map((d) => [d.outcome, d.notChecked]), [["not_checked", "nothing_asserted"], ["not_checked", "scenario_doubted"]]);
  assert.equal(doc.summary, "0 passed, 2 not checked: vague, wrong");
  assert.match(doc.next, /^Not checked is not a pass\./);
});

test("an error without a verdict reports what Kane left behind", () => {
  const doc = buildDoc(input([result("x", "error", undefined, { error: "Kane stopped responding and the run was cut off" })]));
  assert.equal(doc.exitCode, 2);
  assert.equal(doc.scenarios[0]!.reason, "Kane stopped responding and the run was cut off");
  assert.equal(doc.summary, "Kane couldn't finish: x");
});

test("a cached pass costs nothing and says since when", () => {
  const doc = buildDoc(input([{ scenario: scenario("promo"), cached: { key: "k", passedAt: "2026-11-16T10:00:00.000Z", seconds: 60 } }]));
  assert.equal(doc.exitCode, 0);
  assert.equal(doc.credits, 0);
  assert.deepEqual([doc.scenarios[0]!.outcome, doc.scenarios[0]!.cached, doc.scenarios[0]!.cachedAt], ["passed", true, "2026-11-16T10:00:00.000Z"]);
  assert.equal(doc.summary, "1 of 1 passed (1 cached)");
  assert.equal(doc.rerun, undefined);
});

test("the re-run of a free-text check repeats the text, quoted for a shell", () => {
  assert.equal(rerunCommand(["asked"], { text: "the kettle's price is €45", flags: [] }), `proofed check 'the kettle'\\''s price is €45'`);
});

test("a refuted check keeps the failure and gives a conditional next step instead of Kane's suggestion", () => {
  const doc = buildDoc(input([refuted()]));
  const failed = doc.scenarios[0]!;
  assert.equal(doc.exitCode, 1);
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.failedCheck, "scenario_doubted");
  assert.equal(failed.notChecked, undefined);
  assert.match(failed.diagnosis!, /^The test used the wrong/);
  assert.equal(failed.suggestion, FAILED_CHECK_ACTION);
  assert.equal(doc.next, `${FAILED_CHECK_ACTION} Then run: ${failed.rerun}`);
  assert.doesNotMatch(JSON.stringify(doc), /Update the test expectation/);
});
