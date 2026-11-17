import assert from "node:assert/strict";
import { test } from "node:test";
import { configuredFixer } from "./agent.ts";
import { DEFAULT_FIXER, describeFixer, effortsFor, isModelId, modelLabel, MODELS, parseModel, resolveFixer } from "./models.ts";

test("the catalog keeps Claude defaults and identifies every Codex model", () => {
  assert.deepEqual(DEFAULT_FIXER, { model: "claude-haiku-5-5", effort: "xhigh" });
  for (const model of MODELS) {
    assert.deepEqual(parseModel([model.name]), { model: model.id });
    assert.deepEqual(parseModel([model.id]), { model: model.id });
    assert.equal(isModelId(model.id), true);
    assert.ok(model.efforts.includes("high"));
  }
  assert.equal(isModelId("gpt-invented"), false);
  assert.deepEqual(parseModel(["codex"]), { model: "gpt-6.1-sol" });
  assert.equal(modelLabel("gpt-6.1-terra"), "GPT-6.1 Terra");
  assert.equal(describeFixer({model:"gpt-6.1-sol",effort:"low"}), "Codex GPT-6.1 Sol, low effort");
  assert.ok(effortsFor("gpt-6.1-sol").includes("ultra"));
  assert.ok(!effortsFor("gpt-6-luna").includes("ultra"));
  assert.ok(!effortsFor("claude-opus-5-5").includes("ultra"));
});

test("provider/model changes resolve defaults and reject mismatched efforts", () => {
  assert.deepEqual(resolveFixer({provider:"codex"}), {provider:"codex",model:"gpt-6.1-sol",effort:"xhigh"});
  assert.deepEqual(resolveFixer({model:"gpt-6-luna"}, {model:"gpt-6.1-sol",effort:"ultra"}), {provider:"codex",model:"gpt-6-luna",effort:"high"});
  assert.ok("error" in resolveFixer({model:"gpt-6-luna",effort:"ultra"}));
  assert.ok("error" in resolveFixer({provider:"claude",model:"gpt-6.1-sol"}));
});

test("existing action env still configures Claude, generic model env configures Codex", () => {
  const names = ["PROOFED_PROVIDER", "PROOFED_MODEL", "PROOFED_EFFORT", "PROOFED_CLAUDE_MODEL", "PROOFED_CLAUDE_EFFORT"];
  const before = names.map((name) => process.env[name]);
  try {
    names.forEach((name) => delete process.env[name]);
    process.env.PROOFED_CLAUDE_MODEL = "claude-opus-5-1";
    process.env.PROOFED_CLAUDE_EFFORT = "max";
    assert.deepEqual(configuredFixer(), {provider:"claude",model:"claude-opus-5-1",effort:"max"});
    process.env.PROOFED_MODEL = "gpt-6.1-sol";
    process.env.PROOFED_EFFORT = "ultra";
    assert.deepEqual(configuredFixer(), {provider:"codex",model:"gpt-6.1-sol",effort:"ultra"});
  } finally {
    names.forEach((name,i) => { if (before[i] === undefined) delete process.env[name]; else process.env[name] = before[i]; });
  }
});
