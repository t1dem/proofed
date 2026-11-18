import { delimiter } from "node:path";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { askCodex } from "./codex.ts";
import { askAgent } from "./agent.ts";

test("Codex runs once on PATH with a bounded sandbox, stdin prompt and final message", () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-fake-codex-"));
  const before = process.env.PATH;
  const token = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "proofed-test-github-secret";
  try {
    const capture = join(dir, "args.json");
    writeFileSync(join(dir, "codex"), `#!/usr/bin/env node
      const fs = require('node:fs');
      const args = process.argv.slice(2);
      fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({args, input:fs.readFileSync(0,'utf8'), cwd:process.cwd(), env:process.env}));
      const input = fs.readFileSync(${JSON.stringify(capture)}, 'utf8');
      const mode = JSON.parse(input).input;
      if (mode === 'timeout') setTimeout(() => {}, 10000);
      else if (mode === 'empty') process.exit(0);
      else if (mode !== 'fix this') {console.log(JSON.stringify({type:'turn.failed',error:{message:mode}}));process.exit(1);}
      else {fs.writeFileSync(args[args.indexOf('--output-last-message')+1], ' SUMMARY: fixed it.\\n');console.log(JSON.stringify({type:'turn.completed'}));}
    `, {mode:0o755});
    process.env.PATH = `${dir}${delimiter}${before}`;
    const options = {model:"gpt-6.1-sol",effort:"low",cwd:dir,timeoutMs:2000};
    assert.deepEqual(askCodex("fix this", options), {ok:true,text:"SUMMARY: fixed it."});
    const called = JSON.parse(readFileSync(capture,"utf8")) as {args:string[];input:string;cwd:string;env:Record<string,string>};
    assert.equal(called.args[0], "exec");
    assert.equal(called.args[called.args.indexOf('--sandbox')+1], 'workspace-write');
    for (const flag of ['approval_policy="never"','model_reasoning_effort="low"','sandbox_workspace_write.network_access=false','--ignore-user-config','--ignore-rules','--ephemeral','--json']) assert.ok(called.args.includes(flag), flag);
    assert.equal(called.env.GITHUB_TOKEN, undefined);
    assert.ok(called.args.includes('shell_environment_policy.inherit="none"'));
    assert.equal(called.input, "fix this");
    assert.equal(called.args.at(-1), '-');
    assert.ok(!called.args.includes('--dangerously-bypass-approvals-and-sandbox'));
    assert.deepEqual(askAgent("fix this", {...options,allowedTools:[]}), {ok:true,text:"SUMMARY: fixed it."});
    for (const [error, expected] of [['Usage limit reached', /usage limit reached/i],['model gpt-6.1-sol is not supported', /isn't available/],['401 Unauthorized', /isn't logged in/],['some failure',/some failure/],['empty',/without a final answer/],['timeout',/didn't finish within/]] as const) {
      const answer = askCodex(error, {...options,timeoutMs:error === 'timeout' ? 100 : 2000});
      assert.equal(answer.ok,false);
      if (!answer.ok) assert.match(answer.message,expected);
    }
    process.env.PATH = dir;
    // A missing executable is reported without leaking spawn internals to the caller.
    rmSync(join(dir, "codex"));
    const missing = askCodex("fix this",options);
    assert.ok(!missing.ok && missing.message.includes("Install @openai/codex"));
  } finally {
    process.env.PATH = before;
    if (token === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = token;
    rmSync(dir,{recursive:true,force:true});
  }
});
