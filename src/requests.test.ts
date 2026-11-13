import assert from "node:assert/strict";
import { test } from "node:test";
import { descriptionRequest, parseCommand } from "./requests.ts";

test("/proofed alone re-runs the check; with text it asks for that", () => {
  assert.equal(parseCommand("/proofed"), "");
  assert.equal(parseCommand("Looks good.\n/proofed убедись что рулетка крутится"), "убедись что рулетка крутится");
  assert.equal(parseCommand("see https://example.com/proofed-docs"), undefined);
  assert.equal(parseCommand("@proofed please"), undefined);
});

test("a PR description is a request unless it's a template comment or a long changelog", () => {
  assert.equal(descriptionRequest("Убедится что работает рулетка на главном экране"), "Убедится что работает рулетка на главном экране");
  assert.equal(descriptionRequest("<!-- describe your change -->\n"), undefined);
  assert.equal(descriptionRequest(null), undefined);
  assert.equal(descriptionRequest("x".repeat(2000)), undefined);
});
