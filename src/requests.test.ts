import assert from "node:assert/strict";
import { test } from "node:test";
import { askedScenario, descriptionRequest, parseCommand, parseFix } from "./requests.ts";
import { cacheKey } from "./cache.ts";
import { resolveScenarioTarget } from "./target.ts";

test("/proofed alone re-runs the check; with text it asks for that", () => {
  assert.equal(parseCommand("/proofed"), "");
  assert.equal(parseCommand("Looks good.\n/proofed убедись что рулетка крутится"), "убедись что рулетка крутится");
  assert.equal(parseCommand("see https://example.com/proofed-docs"), undefined);
  assert.equal(parseCommand("@proofed please"), undefined);
});

test("/proofed fix takes a short name, a version or a full model ID, and an optional effort", () => {
  assert.equal(parseFix("check the menu"), undefined);
  assert.equal(parseFix("fixed header works?"), undefined);
  assert.deepEqual(parseFix("fix"), { effort: undefined });
  assert.deepEqual(parseFix("fix high"), { effort: "high" });
  assert.deepEqual(parseFix("fix Opus"), { model: "claude-opus-5-5", effort: undefined });
  assert.deepEqual(parseFix("fix fable 5.2 high"), { model: "claude-fable-5-2", effort: "high" });
  assert.deepEqual(parseFix("fix claude-opus-5-1 max\nthanks"), { model: "claude-opus-5-1", effort: "max" });
  const typo = parseFix("fix fabel high");
  assert.ok(typo && "error" in typo && typo.error.includes("`fabel`"));
});

test("a PR description is a request unless it's a template comment or a long changelog", () => {
  assert.equal(descriptionRequest("Убедится что работает рулетка на главном экране"), "Убедится что работает рулетка на главном экране");
  assert.equal(descriptionRequest("<!-- describe your change -->\n"), undefined);
  assert.equal(descriptionRequest(null), undefined);
  assert.equal(descriptionRequest("x".repeat(2000)), undefined);
});

test("only a PR description gets told it may ask for nothing", () => {
  assert.match(askedScenario("description", "Will be closed").objective, /stop right away without clicking anything[^]*Never sign in/);
  assert.doesNotMatch(askedScenario("comment", "the cart total").objective, /Never sign in/);
});

test("ad hoc web objectives and cache keys keep their existing text", () => {
  const target = resolveScenarioTarget({ target: "web" }, {}, {}, process.cwd());
  for (const where of ["terminal", "comment", "description"] as const) {
    const s = askedScenario(where, "the counter increments", target);
    const objective = `The ${where === "terminal" ? "developer of this app" : "author of this pull request"} asked for this to be checked:\n\nthe counter increments\n\n` +
      "Open the app and check exactly that in the browser, the way a user would. It passes only if what they " +
      "asked about actually works; the page loading is not enough." +
      (where === "description" ? " If the text above doesn't describe something a user can see or do in this app, stop right away without clicking anything: there is nothing to check. Never sign in, and never leave the app's own pages to get there." : "");
    assert.equal(s.objective, objective);
    assert.equal(cacheKey(s, "http://localhost/", [], () => undefined), cacheKey({ ...s, objective }, "http://localhost/", [], () => undefined));
  }
});

test("ad hoc objectives use the native target and execution wording", () => {
  for (const [kind, execution, location] of [
    ["android", "local", "on an Android emulator"],
    ["android", "cloud", "on an Android device"],
    ["ios", "local", "in an iOS simulator"],
    ["ios", "cloud", "on an iOS device"],
    ["desktop", "local", "in the desktop app"],
  ] as const) {
    const target = resolveScenarioTarget({ target: kind, execution }, {}, {}, process.cwd());
    for (const where of ["terminal", "comment", "description"] as const) {
      const { objective } = askedScenario(where, "the counter increments", target);
      assert.ok(objective.includes(`check exactly that ${location}, the way a user would.`));
      assert.match(objective, /the app loading is not enough/);
      assert.doesNotMatch(objective, /in the browser|the page loading/);
    }
  }
});

test("PR requests resolve the target from the environment", () => {
  const before = { target: process.env.PROOFED_TARGET, execution: process.env.PROOFED_EXECUTION };
  try {
    process.env.PROOFED_TARGET = "ios";
    process.env.PROOFED_EXECUTION = "cloud";
    for (const where of ["comment", "description"] as const) {
      assert.match(askedScenario(where, "the counter increments").objective, /check exactly that on an iOS device/);
    }
  } finally {
    if (before.target === undefined) delete process.env.PROOFED_TARGET; else process.env.PROOFED_TARGET = before.target;
    if (before.execution === undefined) delete process.env.PROOFED_EXECUTION; else process.env.PROOFED_EXECUTION = before.execution;
  }
});

test("fix accepts a Codex provider, aliases and full IDs with per-model efforts", () => {
  assert.deepEqual(parseFix("fix sol high"), {model:"gpt-6.1-sol",effort:"high"});
  assert.deepEqual(parseFix("fix codex"), {model:"gpt-6.1-sol",effort:undefined});
  assert.deepEqual(parseFix("fix gpt-6-astra ultra"), {model:"gpt-6-astra",effort:"ultra"});
  assert.ok("error" in parseFix("fix luna ultra")!);
  assert.ok("error" in parseFix("fix opus ultra")!);
});
