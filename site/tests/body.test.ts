import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeSegment } from "../src/worker/body.ts";

test("a path segment with broken percent-encoding decodes to undefined instead of throwing", () => {
  assert.equal(decodeSegment("Add%20to%20cart"), "Add to cart");
  assert.equal(decodeSegment("%E0"), undefined);
  assert.equal(decodeSegment("100%"), undefined);
});
