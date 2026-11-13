import assert from "node:assert/strict";
import { test } from "node:test";
import { addRun, alreadyReported, buildReport, fixRequested, readReportData, type ReportData } from "./report.ts";
import { crashResult } from "./precheck.ts";
import { askedScenario } from "./requests.ts";
import { NOTHING_CHECKED, type ScenarioResult } from "./run.ts";

const failed: ScenarioResult = {
  scenario: { id: "promo", file: "promo.md", name: "Promo", paths: [], url: "/", objective: "Total is €81.90 -- after the code" },
  outcome: "failed",
  steps: [],
  end: { type: "run_end", status: "failed", reason: "Total shows €91.00, not €81.90." },
  clip: undefined,
};
const passed: ScenarioResult = { ...failed, outcome: "passed", end: { type: "run_end", status: "passed", reason: "" } };
const fix = { status: "fixed", attempts: 1, summary: "Prices are in cents.", model: "claude-haiku-5-5", effort: "high", commit: "9f8e7d6c5b" } as const;

test("failure data survives the round trip through the comment", () => {
  const body = buildReport({ sha: "abc1234def", results: [failed], skipped: [], clips: new Map(), fixEnabled: true });
  const data = readReportData(body);
  assert.equal(data?.failures[0]?.objective, "Total is €81.90 -- after the code");
  assert.equal(fixRequested(body), false);
  assert.equal(fixRequested(body.replace("- [ ] **Fix", "- [x] **Fix")), true);
  assert.match(body, /<code>\/proofed fix<\/code>/);
});

test("the report names the model that fixed it once", () => {
  const body = buildReport({ sha: "abc1234def", results: [passed], skipped: [], clips: new Map(), fixEnabled: true, fix });
  assert.match(body, /\*\*Fixed in `9f8e7d6`\*\* by Claude Haiku 5\.5, high effort, after 1 attempt\.\n\n\*\*What changed:\*\* Prices are in cents\./);
  assert.doesNotMatch(body, /claude-haiku-5-5/);
  assert.doesNotMatch(body, /\/proofed fix/);
});

test("after a fix, the failing report and the passing run make a before/after", () => {
  const raw = "https://github.com/o/r/raw/proofed-clips/pr-1";
  const cart: ScenarioResult = { ...failed, scenario: { ...failed.scenario, id: "cart", name: "Cart" } };
  const failing = buildReport({
    sha: "1111111aaaa", results: [failed, cart], skipped: [], fixEnabled: true,
    clips: new Map([["promo", { gif: `${raw}/a/promo.gif`, mp4: `${raw}/a/promo.mp4`, jpg: `${raw}/a/promo.jpg` }]]),
  });
  const after = { ...passed, end: { type: "run_end", status: "passed", summary: "The total is €81.90." } } satisfies ScenarioResult;
  const body = buildReport({
    sha: "9f8e7d6c5b", results: [after, { ...cart, outcome: "passed" }], skipped: [], fixEnabled: true, previous: readReportData(failing),
    clips: new Map([["promo", { gif: `${raw}/b/promo.gif`, mp4: `${raw}/b/promo.mp4` }]]),
    fix: { ...fix, commitUrl: "https://github.com/o/r/commit/9f8e7d6c5b", changes: [{ file: "src/pricing.ts", added: 3, removed: 1 }] },
  });
  assert.match(
    body,
    /All 2 affected scenarios pass in a real browser\.\n\n\*\*Fixed in \[`9f8e7d6`\]\(https:\/\/github\.com\/o\/r\/commit\/9f8e7d6c5b\)\*\* by Claude Haiku 5\.5, high effort, after 1 attempt\.\n\n\*\*What changed:\*\* `src\/pricing\.ts` \(\+3 −1\)\. Prices are in cents\.\n\n#### ✓ Promo\n\n\| Before · `1111111` \| After · `9f8e7d6` \|/,
  );
  assert.match(body, /\n\n#### ✓ Cart\n\n\| Before/);
  // Said once for the whole fix, not under every repaired scenario.
  assert.equal(body.split("What changed").length, 2);
  assert.equal(body.split("/commit/9f8e7d6c5b").length, 2);
  // The old run has a still; the new one only a GIF, which stands in for it.
  assert.match(body, /\| <a href="[^"]+\/a\/promo\.mp4"><img src="[^"]+\/a\/promo\.jpg" width="360"[^|]+\| <a href="[^"]+\/b\/promo\.mp4"><img src="[^"]+\/b\/promo\.gif" width="360"/);
  assert.match(body, /\| ✗ Total shows €91\.00, not €81\.90\. \| ✓ The total is €81\.90\. \|/);
  assert.doesNotMatch(body, /Passed:/);
  assert.deepEqual(readReportData(body)?.history, [{ sha: "1111111aaaa", state: "failed" }, { sha: "9f8e7d6c5b", state: "fixed" }]);
  assert.match(body, /1111111 ✗ → 9f8e7d6 ✓ fixed/);
});

test("data from a report written before clips and history were kept still makes a report", () => {
  const old = buildReport({ sha: "1111111aaaa", results: [failed], skipped: [], clips: new Map(), fixEnabled: true })
    .replace(/<!-- proofed:data .* -->/s, `<!-- proofed:data {"sha":"1111111aaaa","failures":[{"id":"promo","name":"Promo","file":"promo.md","objective":"x","reason":"Total shows €91.00.","diagnosis":"","steps":["✗ Total is wrong"]}]} -->`);
  const previous = readReportData(old);
  const body = buildReport({ sha: "9f8e7d6c5b", results: [passed], skipped: [], clips: new Map(), fixEnabled: true, fix, previous });
  assert.match(body, /\| ✗ Total shows €91\.00\. \| ✓ Passes\. \|/);
  assert.doesNotMatch(body, /<img/);
  assert.deepEqual(readReportData(body)?.history, [{ sha: "9f8e7d6c5b", state: "fixed" }]);
  assert.doesNotMatch(body, / → /);
});

test("the run history keeps the last 8 runs, one per commit", () => {
  let history: ReportData["history"] = [];
  for (let i = 0; i < 10; i++) history = addRun(history, { sha: `sha${i}`, state: "failed" });
  history = addRun(history, { sha: "sha9", state: "passed" });
  assert.deepEqual(history.map((h) => h.sha), ["sha2", "sha3", "sha4", "sha5", "sha6", "sha7", "sha8", "sha9"]);
  assert.equal(history.at(-1)?.state, "passed");
});

test("a pass where nothing was checked isn't counted as one", () => {
  const nothing: ScenarioResult = {
    ...failed,
    scenario: { ...failed.scenario, id: "menu", name: "Menu opens" },
    outcome: "unsure",
    end: { type: "run_end", status: "passed", reason: NOTHING_CHECKED },
  };
  const body = buildReport({ sha: "abc1234def", results: [passed, nothing], skipped: [], clips: new Map(), fixEnabled: true });
  assert.match(body, /\*\*1 of 2\*\* scenarios pass in a real browser; 1 wasn't checked\./);
  assert.match(body, /#### ⚠ Menu opens: not checked\n\n> Kane finished without checking anything on the page\./);
  assert.doesNotMatch(body, /may be wrong|All 2/);
});

test("a page that crashed on load shows the browser's error, not Kane's", () => {
  const body = buildReport({
    sha: "abc1234def", results: [crashResult(failed.scenario, { error: "TypeError: Cannot read properties of null (reading '1')" })],
    skipped: [], clips: new Map(), fixEnabled: true,
  });
  assert.match(body, /> The page is blank: it crashed while loading, before anything could be checked\.\n\n\*\*Browser console error:\*\* `TypeError: Cannot read properties of null \(reading '1'\)`/);
  assert.doesNotMatch(body, /What Kane saw/);
  assert.equal(readReportData(body)?.failures[0]?.diagnosis, "TypeError: Cannot read properties of null (reading '1')");
});

test("only the push of the commit the report is about skips the check", () => {
  const data = readReportData(buildReport({ sha: "9f8e7d6c5b", results: [passed], skipped: [], clips: new Map(), fixEnabled: true }));
  assert.equal(alreadyReported("synchronize", "9f8e7d6c5b", data), true);
  // A person's push is a new commit.
  assert.equal(alreadyReported("synchronize", "1234567890", data), false);
  // "/proofed" re-runs the same commit on purpose.
  assert.equal(alreadyReported("created", "9f8e7d6c5b", data), false);
  assert.equal(alreadyReported("opened", "9f8e7d6c5b", data), false);
  assert.equal(alreadyReported("synchronize", "9f8e7d6c5b", undefined), false);
});

const description = askedScenario("description", "Test run of the action. Will be closed, not merged.");
const askedNothing: ScenarioResult = {
  scenario: description,
  outcome: "unsure",
  steps: [],
  end: {
    type: "run_end", status: "failed", reason: "The description doesn't name anything to check.", credits_consumed: 4,
    verdict: { family: "automation_bug", root_cause: "No objective.", suggestion: "Configure OAuth." },
  },
  clip: undefined,
};

test("a PR description that asks for nothing is one quiet line, not a scenario", () => {
  const body = buildReport({ sha: "abc1234def", results: [askedNothing], skipped: [], clips: new Map(), fixEnabled: true, asked: [description] });
  assert.match(body, /### Proofed\n\nThis PR doesn't touch the files of any scenario, so there was nothing to run\./);
  assert.match(body, /<sub>The PR description didn't name anything Kane could check in the browser\.<\/sub>/);
  assert.doesNotMatch(body, /⚠|may be wrong|Kane suggests|OAuth|not checked/);
  assert.match(body, /4 credits/);
  // Nothing for the fixer to re-run, and nothing broke.
  assert.deepEqual(readReportData(body)?.asked, undefined);
  assert.deepEqual(readReportData(body)?.history, [{ sha: "abc1234def", state: "passed" }]);
  // Kane passing without an assert is the same thing.
  const unchecked = { ...askedNothing, end: { type: "run_end", status: "passed", reason: NOTHING_CHECKED } } satisfies ScenarioResult;
  const passedBlind = buildReport({ sha: "abc1234def", results: [unchecked], skipped: [], clips: new Map(), fixEnabled: true });
  assert.match(passedBlind, /there was nothing to run.[^]*didn't name anything Kane could check/);
  assert.doesNotMatch(passedBlind, /⚠|not checked/);
});

test("next to a real pass, a description that asks for nothing isn't counted", () => {
  const four = ["a", "b", "c", "d"].map((id) => ({ ...passed, scenario: { ...passed.scenario, id, name: id.toUpperCase() } }));
  const body = buildReport({ sha: "abc1234def", results: [...four, askedNothing], skipped: [], clips: new Map(), fixEnabled: true, asked: [description] });
  assert.match(body, /All 4 affected scenarios pass in a real browser\./);
  assert.match(body, /- ✓ A\n- ✓ B\n- ✓ C\n- ✓ D\n\n/);
  assert.doesNotMatch(body, /What the PR description asks|⚠|of 5/);
  assert.match(body, /didn't name anything Kane could check/);
});

test("a PR description whose check failed is reported as before", () => {
  const broke: ScenarioResult = { ...failed, scenario: description };
  const body = buildReport({ sha: "abc1234def", results: [passed, broke], skipped: [], clips: new Map(), fixEnabled: true, asked: [description] });
  assert.match(body, /\*\*1 of 2\*\* scenarios broke on this PR\./);
  assert.match(body, /#### ✗ What the PR description asks\n\n> Total shows €91\.00, not €81\.90\./);
  assert.match(body, /- \[ \] \*\*Fix with Claude\*\*/);
  assert.doesNotMatch(body, /didn't name anything/);
  assert.equal(readReportData(body)?.asked?.[0]?.id, "asked-in-description");
  assert.equal(readReportData(body)?.failures[0]?.id, "asked-in-description");
});

test("after a fix of a page that crashed on load before screenshots, the Before side has only the browser's error", () => {
  const raw = "https://github.com/o/r/raw/proofed-clips/pr-1";
  const crash = crashResult(failed.scenario, { error: "TypeError: Cannot read properties of null (reading '1') | x" });
  const failing = buildReport({ sha: "1111111aaaa", results: [crash], skipped: [], clips: new Map(), fixEnabled: true });
  const body = buildReport({
    sha: "9f8e7d6c5b", results: [passed], skipped: [], fixEnabled: true, fix, previous: readReportData(failing),
    clips: new Map([["promo", { gif: `${raw}/b/promo.gif`, mp4: `${raw}/b/promo.mp4`, jpg: `${raw}/b/promo.jpg` }]]),
  });
  const table = /\| Before[^\n]*\n\|---\|---\|\n((?:\|[^\n]*\n?)+)/.exec(body)?.[1]?.trim().split("\n") ?? [];
  assert.equal(table.length, 1);
  assert.match(
    table[0]!,
    /^\| ✗ The page is blank: it crashed while loading, before anything could be checked\.<br><br>`TypeError: Cannot read properties of null \(reading '1'\) \\\| x` \| <a href="[^"]+\/b\/promo\.mp4"><img src="[^"]+\/b\/promo\.jpg" width="360"[^>]*><\/a><br>✓ Passes\. \|$/,
  );
});

test("a page that crashed on load shows its screenshot, and after a fix the before/after has a picture on both sides", () => {
  const raw = "https://github.com/o/r/raw/proofed-clips/pr-1";
  const crash = crashResult(failed.scenario, { error: "TypeError: Cannot read properties of null (reading '1')", screenshot: "/tmp/crash-0.jpg" });
  assert.deepEqual(crash.clip, { jpg: "/tmp/crash-0.jpg" });
  const failing = buildReport({
    sha: "1111111aaaa", results: [crash], skipped: [], fixEnabled: true,
    clips: new Map([["promo", { jpg: `${raw}/a/promo.jpg` }]]),
  });
  assert.match(
    failing,
    /> The page is blank[^\n]*\n\n<img src="[^"]+\/a\/promo\.jpg" width="720" alt="What a user sees on opening the page">\n\n<sub>This is what a user sees on opening `\/`\.<\/sub>\n\n\*\*Browser console error:\*\*/,
  );
  assert.doesNotMatch(failing, /Watch as video|Kane's run/);
  assert.deepEqual(readReportData(failing)?.failures[0]?.clip, { jpg: `${raw}/a/promo.jpg` });

  const body = buildReport({
    sha: "9f8e7d6c5b", results: [passed], skipped: [], fixEnabled: true, fix, previous: readReportData(failing),
    clips: new Map([["promo", { gif: `${raw}/b/promo.gif`, mp4: `${raw}/b/promo.mp4`, jpg: `${raw}/b/promo.jpg` }]]),
  });
  const table = /\| Before[^\n]*\n\|---\|---\|\n((?:\|[^\n]*\n?)+)/.exec(body)?.[1]?.trim().split("\n") ?? [];
  assert.equal(table.length, 2);
  assert.match(table[0]!, /^\| <img src="[^"]+\/a\/promo\.jpg" width="360" alt="What a user sees on opening the page"> \| <a href="[^"]+\/b\/promo\.mp4"><img src="[^"]+\/b\/promo\.jpg"/);
  assert.match(table[1]!, /^\| ✗ The page is blank[^|]*<br><br>`TypeError[^|]*\| ✓ Passes\. \|$/);
});
