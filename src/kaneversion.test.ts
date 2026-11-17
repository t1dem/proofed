import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readKaneVersion } from "./kaneversion.ts";

const bin = fileURLToPath(new URL("./testing/fake-kane.ts", import.meta.url));
const warning = "kane-cli: bundled Node runtime not found - running on system node 24.11.1";

test("Kane version ignores runtime warnings and extracts only the version line", () => {
  const env = { ...process.env, FAKE_KANE_VERSION: "0.10.4" };
  assert.equal(readKaneVersion(bin, env), "0.10.4");
  assert.equal(readKaneVersion(bin, { ...env, FAKE_KANE_VERSION_WARNING: warning }), "0.10.4");
  assert.equal(readKaneVersion(bin, { ...env, FAKE_KANE_VERSION: `${warning}\nv0.10.4` }), "0.10.4");
});

test("unreadable Kane versions stay unknown, including warnings with Node versions", () => {
  assert.equal(readKaneVersion(bin, { ...process.env, FAKE_KANE_VERSION: "", FAKE_KANE_VERSION_WARNING: warning }), "unknown");
  assert.equal(readKaneVersion("/nonexistent/proofed-kane"), "unknown");
});
