import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { samePage, startRecorder } from "./recorder.ts";

const page = { doc: 1731680000123.4, href: "https://shop.test/cart", sx: 0, sy: 400, w: 1920, h: 1080 };

test("samePage: a cursor stays only on the document, address, scroll and layout it was placed on", () => {
  assert.ok(samePage(page, { ...page, sy: 401 }));
  assert.ok(!samePage(page, { ...page, doc: 1731680004567.8 }));
  assert.ok(!samePage(page, { ...page, href: "https://shop.test/checkout" }));
  assert.ok(!samePage(page, { ...page, sy: 0 }));
  assert.ok(!samePage(page, { ...page, w: 800, h: 450 }));
});

test("web recording times out while waiting for the CDP WebSocket handshake", { timeout: 5000 }, async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-recorder-"));
  const deadline = new AbortController();
  const timeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, "timeout", (ms: number) => ms === 30_000 ? deadline.signal : timeout(ms));
  const server = createServer((req, res) => {
    res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://${req.headers.host}/devtools/browser/test` }));
  });
  server.on("upgrade", (_req, socket) => {
    deadline.abort(new DOMException("Connection timed out", "TimeoutError"));
    socket.destroy();
  });
  t.after(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await assert.rejects(startRecorder(`http://127.0.0.1:${address.port}`, dir, undefined, 1000), { name: "TimeoutError" });
});
