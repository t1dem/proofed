import assert from "node:assert/strict";
import { test } from "node:test";

test("frames go out one at a time, in order, and only the newest waits behind a slow upload", async () => {
  Object.assign(process.env, { PROOFED_SERVER: "http://proofed.test", ACTIONS_ID_TOKEN_REQUEST_URL: "http://proofed.test/oidc", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "t" });
  const sent: string[] = [];
  let open = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/oidc") return Response.json({ value: "token" });
    if (url.pathname.endsWith("/frame")) {
      assert.equal(++open, 1, "one frame upload at a time");
      await new Promise((r) => setTimeout(r, 50));
      sent.push(`${url.searchParams.get("scenario")}:${url.searchParams.get("x") ?? "-"}`);
      open--;
    }
    return new Response(null, { status: 204 });
  };
  const { live } = await import("./live.ts");
  const jpeg = new Uint8Array([0xff, 0xd8]);
  const t = Date.now();
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  live.start({ kind: "check", pr: 1, sha: "abc", runUrl: undefined });
  live.frame("b", { jpeg, at: t });
  // Waits behind b's upload, and a newer action frame of the same scenario takes its place.
  live.frame("a", { jpeg, at: t });
  live.frame("a", { jpeg, at: t + 1, cursor: { x: 0.1, y: 0.1 } }, true);
  await wait(600);
  live.frame("a", { jpeg, at: t + 2, cursor: { x: 0.2, y: 0.2 } }, true);
  await wait(600);
  // A screenshot asked for before the last action and done after it shows the past.
  live.frame("a", { jpeg, at: t + 1 }, true);
  await wait(600);
  live.frame("a", { jpeg, at: t + 3, cursor: { x: 0.3, y: 0.3 } }, true);
  await wait(200);
  await live.end();
  assert.deepEqual(sent, ["b:-", "a:0.1000", "a:0.2000", "a:0.3000"]);
});
