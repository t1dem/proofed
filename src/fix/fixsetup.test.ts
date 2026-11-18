import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fixSetup } from "./fixsetup.ts";
import { buildReport } from "../report/report.ts";
import type { ScenarioResult } from "../types.ts";

const REF = "o/r/.github/workflows/proofed.yml@refs/heads/main";

test("an old workflow gets a note instead of a fix box that would do nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-fixsetup-"));
  mkdirSync(join(dir, ".github/workflows"), { recursive: true });
  const workflow = (text: string) => writeFileSync(join(dir, ".github/workflows/proofed.yml"), text);
  const env = { GITHUB_WORKFLOW_REF: REF, GITHUB_WORKSPACE: dir };
  try {
    workflow("contains(github.event.comment.body, '- [x] **Fix with Claude**')\n");
    const noKey = fixSetup("codex", { ...env, PROOFED_CODEX: "false" });
    assert.equal(noKey?.comment, false);
    assert.match(noKey!.note, /To fix with Codex, add `codex-api-key: \$\{\{ secrets\.CODEX_API_KEY \}\}` or `codex-auth-json: \$\{\{ secrets\.CODEX_AUTH_JSON \}\}`/);
    const onlyClaude = fixSetup("codex", { ...env, PROOFED_CODEX: "true" });
    assert.equal(onlyClaude?.comment, true);
    assert.match(onlyClaude!.note, /only when \*\*Fix with Claude\*\* is ticked/);
    assert.equal(fixSetup("claude", { ...env, PROOFED_CLAUDE: "true" }), undefined);
    assert.equal(fixSetup("claude", { ...env, PROOFED_CLAUDE: "false" })?.comment, false);
    workflow("contains(github.event.comment.body, '- [x] **Fix with Claude**') || contains(github.event.comment.body, '- [x] **Fix with Codex**')\n");
    assert.equal(fixSetup("codex", { ...env, PROOFED_CODEX: "true" }), undefined);
    // Outside Actions, or a fix step that doesn't say: nothing is known, the box stays.
    assert.equal(fixSetup("codex", {}), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the report puts the note where the box was, and offers /proofed fix only when a comment can start it", () => {
  const failed = {
    scenario: { id: "promo", file: "promo.md", name: "Promo", paths: [], url: "/", objective: "Check the total." },
    outcome: "failed", steps: [], end: { type: "run_end", status: "failed", reason: "Total shows 0." },
  } as unknown as ScenarioResult;
  const base = { sha: "abc1234def", results: [failed], skipped: [], clips: new Map(), fixEnabled: true, fixer: { model: "gpt-6.1-sol", effort: "low" } };
  assert.match(buildReport(base), /- \[ \] \*\*Fix with Codex\*\*/);
  const noKey = buildReport({ ...base, fixSetup: { note: "Add the key.", comment: false } });
  assert.doesNotMatch(noKey, /Fix with Codex\*\*:/);
  assert.match(noKey, /\n> Add the key\.\n/);
  assert.doesNotMatch(noKey, /proofed fix/);
  const commentOnly = buildReport({ ...base, fixSetup: { note: "Comment instead.", comment: true } });
  assert.doesNotMatch(commentOnly, /- \[ \] \*\*Fix with/);
  assert.match(commentOnly, /<code>\/proofed fix<\/code> to have Codex fix it/);
});
