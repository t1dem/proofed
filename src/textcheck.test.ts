import assert from "node:assert/strict";
import { test } from "node:test";
import { expectedText, textContradiction } from "./textcheck.ts";

test("only explicit quoted positive page text is cross-checked", () => {
  assert.deepEqual(expectedText('Check that the page contains "Order complete".'), ["Order complete"]);
  for (const objective of ['Check that Your favorite tools contains Token generator.', 'Check that "Buy milk" is no longer visible.', 'Check that the button is "red".', 'Draw a "rectangle".']) {
    assert.deepEqual(expectedText(objective), []);
  }
  assert.equal(textContradiction(["Order complete"], undefined), undefined);
  assert.equal(textContradiction(["Order complete"], "ORDER\n complete"), undefined);
  assert.match(textContradiction(["Order complete"], "Other text")!, /Order complete/);
});
