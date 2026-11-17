import assert from "node:assert/strict";
import { test } from "node:test";
import type { Step } from "./kane.ts";
import { cutOffReason, focusWords, kaneError, kaneObjective, outcomeOf, runScenario } from "./run.ts";

test("a failed check is located by the words of its quoted expectation", () => {
  const words = focusWords({ type: "run_end", status: "failed", reason: "The bag shows “That code doesn’t work,” leaving no discount." });
  assert.deepEqual(words, ["code", "doesn't", "work"]);
});

test("Kane is told not to route around a step that misbehaves", () => {
  const objective = kaneObjective("Open the pause menu and press keep drawing.");
  assert.ok(objective.startsWith("Open the pause menu and press keep drawing.\n\n"));
  assert.match(objective, /check fails: don't retry it, and don't reach the goal another way/);
});

test("a passed run is located by the values Kane read off the page", () => {
  const words = focusWords({ type: "run_end", status: "passed", final_state: { url: "http://localhost/cart", shipping: "Free", total: "€51.00" } });
  assert.deepEqual(words, ["free", "€51.00"]);
});

test("Kane's error line is the reason, not the hints printed after it", () => {
  const stderr = [
    "",
    "Update available: 0.10.3 → 0.10.4 — run `npm install -g @testmuai/kane-cli@latest` to update",
    "",
    'error: profile "hackathon" (prod) has no project/folder configured AND no TMS credentials were available to auto-configure one.',
    "",
    "discover IDs:",
    '  kane-cli projects list --search "<keyword>" --limit 10',
    "",
    "set them:",
    "  kane-cli config project <project-id>",
    "  kane-cli config folder <folder-id>",
  ].join("\n");
  assert.equal(kaneError(stderr), 'profile "hackathon" (prod) has no project/folder configured AND no TMS credentials were available to auto-configure one.');
  assert.equal(kaneError("one\ntwo\nthree\nfour\nfive\nsix"), "two\nthree\nfour\nfive\nsix");
});

test("update notices are not the reason, and a cloud run that never started names the device", () => {
  assert.equal(kaneError("Update available: 0.10.3 → 0.10.4\n\nKane crashed\n"), "Kane crashed");
  const ios = { kind: "ios", execution: "cloud", device: "iPhone 15", os_version: "18", sources: {}, dir: "." } as const;
  assert.equal(
    cutOffReason("Skill update available: not installed → 0.1.4\nuploading app.ipa…\n", ios, false),
    "TestMu gave Kane no real device (iPhone 15, iOS 18) within 6 minutes; that model may be busy. Pick another from kane-cli devices list --target ios --remote.",
  );
  assert.equal(cutOffReason("Update available: 0.10.4\nstill thinking\n", ios, true), "Kane stopped responding and the run was cut off after 6 minutes; Kane's last line: still thinking");
  assert.equal(cutOffReason("", { kind: "web", execution: "local", sources: {}, dir: "." }, false), "Kane stopped responding and the run was cut off after 6 minutes");
});

// Steps and verdicts as Kane reported them on PR #3, after the fix.
const step = (remark: string, status: Step["status"] = "done"): Step => ({ step: 0, status, remark, ts: "" });
const pass = { type: "run_end", status: "passed", reason: "Objective completed" } as const;

test("a pass counts only when Kane asserted something on the page", () => {
  const looked = [step("navigate: Navigate to http://localhost:4173/"), step("wait: Waiting verify the example scenario caption starts with its scenario name")];
  assert.equal(outcomeOf(pass, looked), "unsure");
  const asserted = [...looked, step("analyze: the page shows no error message"), step("assert: the main heading is visible and the page shows no error message")];
  assert.equal(outcomeOf(pass, asserted), "passed");
  assert.equal(outcomeOf({ ...pass, status: "failed", verdict: { family: "application_issue" } }, looked), "failed");
  assert.equal(outcomeOf({ ...pass, status: "failed", verdict: { family: "automation_bug" } }, looked), "unsure");
});

// The real run on demo-store with the free shipping threshold moved to €60: every step done, the
// last assert false, and Kane's verdict "The test expectation uses the wrong free-shipping threshold".
test("a check the page refuted is a failure, whatever Kane thinks of the scenario", () => {
  const steps = [
    step("navigate: Navigate to http://localhost:4173/"),
    step("assert: shipping is €4.90 and the total is €49.40"),
    step("analyze: the total is €51.00"),
    step("assert: shipping is now Free and the total is €51.00", "failed"),
  ];
  const end = { ...pass, status: "failed", reason: 'Final verification failed: "shipping is now Free and the total is €51.00"' };
  assert.equal(outcomeOf({ ...end, verdict: { family: "automation_bug" } }, steps), "failed");
  assert.equal(outcomeOf({ ...end, verdict: { family: "automation_bug" } }, [...steps.slice(0, 3), step("click: Click “Apply”", "failed")]), "unsure");
});

test("a supplied scenario id is checked before recording deletes any output", async () => {
  for (const id of ["", ".", "..", "../outside", "nested/file", "nested\\file", "bad\0id"]) {
    await assert.rejects(runScenario({id, file:"", name:"test", paths:[], url:"/", objective:"Open the app."}, {
      baseUrl:"http://localhost:5400", outDir:"/unused-proofed-output",
    }), /unsafe scenario id/);
  }
});
