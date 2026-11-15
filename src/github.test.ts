import assert from "node:assert/strict";
import { test } from "node:test";
import { MARKER, OLD_MARKER, reportsIn, type Comment } from "./github.ts";

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
