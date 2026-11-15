import assert from "node:assert/strict";
import { test } from "node:test";
import { samePage } from "./recorder.ts";

const page = { doc: 1731680000123.4, href: "https://shop.test/cart", sx: 0, sy: 400 };

test("samePage: a cursor stays only on the document, address and scroll it was placed on", () => {
  assert.ok(samePage(page, { ...page, sy: 401 }));
  assert.ok(!samePage(page, { ...page, doc: 1731680004567.8 }));
  assert.ok(!samePage(page, { ...page, href: "https://shop.test/checkout" }));
  assert.ok(!samePage(page, { ...page, sy: 0 }));
});
