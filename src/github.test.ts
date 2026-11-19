import assert from "node:assert/strict";
import { test } from "node:test";
import { getPullRequest, listReports, MARKER, OLD_MARKER, postComment, reportsIn, type Comment } from "./github.ts";

const comment = (id: number, body: string, type = "Bot"): Comment => ({ id, node_id: `IC_${id}`, html_url: `#${id}`, body, user: { type } });

test("the newest of Proofed's reports is the report; replaced ones and pasted markers aren't", () => {
  const { current, older } = reportsIn([
    comment(1, `${OLD_MARKER}\n### Proofed`),
    comment(2, `${MARKER}\n### Proofed`),
    comment(3, `Quoting the bot: ${MARKER}`, "User"),
    comment(4, "Some other bot"),
    comment(5, `${MARKER}\n### Proofed`),
    comment(6, `${OLD_MARKER}\n### Proofed`),
  ]);
  assert.equal(current?.id, 5);
  // One that wasn't retired, say an edit that failed, gets retired with the next new report.
  assert.deepEqual(older.map((c) => c.id), [2]);
  assert.deepEqual(reportsIn([comment(1, `${OLD_MARKER}`), comment(3, MARKER, "User")]), { current: undefined, older: [] });
});

test("report lookup accepts the authenticated user's marker and ignores other users' markers", async (t) => {
  const repo = { owner: "owner", name: "repo", token: "fixture" };
  let lookups = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (new URL(url).pathname === "/user") {
      lookups++;
      return Response.json({ id: 42 });
    }
    return Response.json([
      comment(1, MARKER),
      { ...comment(2, MARKER, "User"), user: { type: "User", id: 42 } },
      { ...comment(3, MARKER, "User"), user: { type: "User", id: 43 } },
    ]);
  });
  const reports = await listReports(repo, 1);
  assert.equal(reports.current?.id, 2);
  assert.deepEqual(reports.older.map((c) => c.id), [1]);
  await listReports(repo, 1);
  assert.equal(lookups, 1);
});

test("installation tokens still find bot reports when the user endpoint is unavailable", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string) => new URL(url).pathname === "/user"
    ? Response.json({}, { status: 403 })
    : Response.json([comment(1, MARKER), { ...comment(2, MARKER, "User"), user: { type: "User", id: 42 } }]));
  const reports = await listReports({ owner: "owner", name: "repo", token: "fixture" }, 1);
  assert.equal(reports.current?.id, 1);
});

test("a dropped response body retries a GET but never replays a POST", async (t) => {
  const repo = { owner: "owner", name: "repo", token: "fixture" };
  let calls = 0;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    calls++;
    if (calls === 1 || init.method === "POST") {
      return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError("connection dropped")); } }));
    }
    return Response.json({ number: 1 });
  });
  const pull = getPullRequest(repo, 1);
  // Let fetch and the body read reject before advancing the retry delay.
  await new Promise<void>((resolve) => setImmediate(resolve));
  t.mock.timers.tick(2000);
  assert.equal((await pull).number, 1);
  await assert.rejects(postComment(repo, 1, MARKER), /connection dropped/);
  assert.equal(calls, 3);
});
