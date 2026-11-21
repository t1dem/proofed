import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeSegment, fromOtherSite, visitorAddress } from "../src/worker/body.ts";

test("a path segment with broken percent-encoding decodes to undefined instead of throwing", () => {
  assert.equal(decodeSegment("Add%20to%20cart"), "Add to cart");
  assert.equal(decodeSegment("%E0"), undefined);
  assert.equal(decodeSegment("100%"), undefined);
});

test("only a request another site made the browser send counts as from another site", () => {
  const req = (headers: Record<string, string>) => new Request("https://proofed.dev/api/keys", { method: "POST", headers });
  assert.equal(fromOtherSite(req({ "sec-fetch-site": "same-origin", origin: "https://proofed.dev" })), false);
  assert.equal(fromOtherSite(req({ "sec-fetch-site": "none" })), false);
  assert.equal(fromOtherSite(req({ origin: "https://proofed.dev" })), false);
  assert.equal(fromOtherSite(req({})), false);
  assert.equal(fromOtherSite(req({ "sec-fetch-site": "cross-site", origin: "https://evil.example" })), true);
  assert.equal(fromOtherSite(req({ "sec-fetch-site": "same-site", origin: "https://x.proofed.dev" })), true);
  assert.equal(fromOtherSite(req({ origin: "https://evil.example" })), true);
});


test("a /try visitor is an IPv4 address or an IPv6 /64", () => {
  assert.equal(visitorAddress("203.0.113.7"), "203.0.113.7");
  assert.equal(visitorAddress("::ffff:203.0.113.7"), "::ffff:203.0.113.7");
  assert.equal(visitorAddress(null), "unknown");
  const one = visitorAddress("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
  assert.equal(one, "2001:db8:1:2::/64");
  assert.equal(visitorAddress("2001:0db8:0001:0002::1"), one);
  assert.equal(visitorAddress("2001:DB8:1:2::ffff"), one);
  assert.notEqual(visitorAddress("2001:db8:1:3::1"), one);
  assert.equal(visitorAddress("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(visitorAddress("::1"), "0:0:0:0::/64");
});
