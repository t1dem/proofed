import assert from "node:assert/strict";
import { test } from "node:test";
import { blockedReport } from "./blocked.ts";

test("a serve that never answers names the command, the folder and the address", () => {
  const body = blockedReport({ stage: "serve", command: "pnpm preview --port 4173", dir: "site", url: "http://localhost:4173", log: "\u001b[31mENOENT dist\u001b[0m\n" });
  assert.match(body, /^<!-- proofed -->\n### Proofed\n\nProofed couldn't finish this check: `pnpm preview --port 4173` in `site\/` didn't answer at http:\/\/localhost:4173/);
  assert.match(body, /```\nENOENT dist\n```/);
});
