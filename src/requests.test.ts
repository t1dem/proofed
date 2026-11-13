import assert from "node:assert/strict";
import { test } from "node:test";
import { descriptionRequest, parseCommand, parseFix } from "./requests.ts";

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
