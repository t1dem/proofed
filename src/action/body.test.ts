import assert from "node:assert/strict";
import { test } from "node:test";
import { readUpTo } from "../../site/src/worker/body.ts";

const streamOf = (sizes: number[], pulled: { count: number }) =>
  new ReadableStream<Uint8Array>({
    pull(controller) {
      const size = sizes[pulled.count++];
      if (size === undefined) controller.close();
      else controller.enqueue(new Uint8Array(size).fill(0xff));
    },
  });

test("a body under the limit comes back whole", async () => {
  const body = await readUpTo(new Request("https://x/", { method: "POST", body: new Uint8Array([0xff, 0xd8, 1, 2]) }), 10);
  assert.deepEqual(body && [...body], [0xff, 0xd8, 1, 2]);
});

test("a declared length over the limit is refused before reading", async () => {
  const pulled = { count: 0 };
  const request = new Request("https://x/", {
    method: "POST",
    body: streamOf([5], pulled),
    headers: { "content-length": "1000" },
    duplex: "half",
  } as RequestInit);
  assert.equal(await readUpTo(request, 10), undefined);
  // A stream pulls its first chunk as it is made; nothing past that may be asked for.
  assert.ok(pulled.count <= 1, `read ${pulled.count} chunks`);
});

test("a stream with no length stops being read once it passes the limit", async () => {
  const pulled = { count: 0 };
  const request = new Request("https://x/", { method: "POST", body: streamOf([6, 6, 6, 6, 6, 6], pulled), duplex: "half" } as RequestInit);
  assert.equal(await readUpTo(request, 10), undefined);
  assert.ok(pulled.count < 6, `read ${pulled.count} chunks`);
});
