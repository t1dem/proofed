import { resolve } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDoc } from "../report/result.ts";
import { colorOn, ending, LiveView, palette, PlainView, since, stripAnsi, textWidth, truncate, type Plan } from "./render.ts";
import { ran, refuted } from "../testing/results.ts";
import { resolveScenarioTarget } from "../targets/target.ts";

const sink = (columns?: number) => {
  let text = "";
  return { write: (s: string) => ((text += s), true), columns, rows: 24, get text() { return text; } };
};

const plan: Plan = {
  run: [{ id: "free-shipping", name: "Free shipping from €50" }, { id: "promo", name: "Promo code total" }],
  cached: [{ id: "checkout", name: "Place an order", cachedAt: "2026-11-16T10:00:00.000Z" }],
  total: 5,
  selection: "changes against origin/main (2 files)",
  url: "http://localhost:4173",
  estimate: 52,
  concurrency: 3,
};

const failed = ran("free-shipping", "failed", { reason: "Shipping shows Free.", credits_consumed: 27, verdict: { family: "product_bug", root_cause: "The threshold is €40." } }, { name: "Free shipping from €50" });
const passed = ran("promo", "passed", { status: "passed", credits_consumed: 25 });
const doc = buildDoc({ items: [failed, passed], skipped: [], base: "origin/main", changedFiles: 2, url: "http://localhost:4173", seconds: 74, out: "/out", rerun: { flags: [] }, estimatedCredits: 52 });

test("truncation counts columns and never splits past the width", () => {
  assert.equal(truncate("assert: shipping is €4.90", 12), "assert: shi…");
  assert.equal(truncate("short", 12), "short");
  assert.equal(textWidth("✓ 漢字"), 6);
  assert.equal(textWidth(palette(true).red("✗ x")), 3);
  assert.ok(textWidth(truncate("漢字漢字漢字", 5)) <= 5);
  assert.equal(truncate("anything", 0), "");
});

test("colour follows NO_COLOR, FORCE_COLOR and a dumb terminal", () => {
  assert.equal(colorOn({}, true), true);
  assert.equal(colorOn({}, false), false);
  assert.equal(colorOn({ NO_COLOR: "1" }, true), false);
  assert.equal(colorOn({ TERM: "dumb" }, true), false);
  assert.equal(colorOn({ FORCE_COLOR: "0" }, true), false);
  assert.equal(colorOn({ FORCE_COLOR: "1" }, false), true);
});

test("the plain view: one line per event, a heartbeat, then the details and the summary", () => {
  let now = 1_000_000;
  const out = sink();
  const view = new PlainView(out, { color: false, now: () => now, heartbeat: 25_000 });
  view.plan(plan);
  view.start();
  view.event({ type: "started", id: "free-shipping" });
  view.event({ type: "started", id: "promo" });
  view.event({ type: "step", id: "free-shipping", step: { step: 2, status: "running", remark: "assert: shipping is €4.90", ts: "" } });
  now += 30_000;
  view.tick();
  now += 40_000;
  view.event({ type: "finished", id: "free-shipping", result: failed.result });
  view.event({ type: "finished", id: "promo", result: passed.result });
  view.done(doc);
  assert.equal(
    out.text,
    [
      "Proofed: checking 2 of 5 scenario(s), changes against origin/main (2 files), at http://localhost:4173.",
      "Estimate: about 52 Kane credits.",
      "Cached passes, 0 credits: Place an order.",
      "Time: about 1 to 4 minutes per scenario, 3 at a time, so 1 to 4 minutes in all. Do not interrupt: let it finish.",
      "[0:00] started free-shipping: Free shipping from €50",
      "[0:00] started promo: Promo code total",
      '[0:30] still running: free-shipping 0:30 at "assert: shipping is €4.90"; promo 0:30',
      "[1:10] failed free-shipping: Free shipping from €50 (1:10, 27 credits (Kane estimate))",
      "[1:10] passed promo: Promo code total (1:10, 25 credits (Kane estimate))",
      "",
      "✗ Free shipping from €50 failed after 1:10",
      "  Kane saw    Shipping shows Free.",
      "  Diagnosis   The threshold is €40.",
      "  Failed step assert: shipping is €4.90",
      `  Clip        ${resolve("/out/x/clip.mp4")}`,
      "  Scenario    .proofed/scenarios/free-shipping.md",
      "",
      "✗ 1 passed, 1 failed · 52 credits (Kane estimate) · 1m 14s",
      "Credits are Kane estimates; account debit can be higher.",
      "1 of 2 broke: Free shipping from €50",
      "Re-run what broke: proofed check --only free-shipping",
      "",
    ].join("\n"),
  );
  assert.doesNotMatch(out.text, /\x1b/);
});

test("the terminal view settles on one line per scenario, then the same ending", () => {
  const now = new Date("2026-11-16T12:00:00").getTime();
  const out = sink(60);
  const view = new LiveView(out, { color: true, now: () => now });
  view.plan(plan);
  view.start();
  view.event({ type: "started", id: "free-shipping" });
  view.event({ type: "finished", id: "free-shipping", result: failed.result });
  view.event({ type: "finished", id: "promo", result: passed.result });
  view.done(doc);
  assert.ok(out.text.includes("\x1b[?25l"), "the cursor is hidden while drawing");
  // The cursor comes back once drawing ends, before the ending is printed.
  const shown = out.text.lastIndexOf("\x1b[?25h");
  assert.ok(shown > out.text.lastIndexOf("\x1b[?25l"));
  const settled = stripAnsi(out.text.slice(out.text.lastIndexOf("\x1b[J") + 3, shown)).split("\n").filter(Boolean);
  assert.deepEqual(settled, [
    `✓ Place an order  cached, unchanged since ${since("2026-11-16T10:00:00.000Z", now)}`,
    "✗ Free shipping from €50  1:10 · 27 credits (Kane estimate)",
    "✓ Promo code total  1:10 · 25 credits (Kane estimate)",
  ]);
  assert.equal(stripAnsi(out.text.slice(shown)).trim(), ending(doc, palette(false)).join("\n").trim());
  for (const line of stripAnsi(out.text).split(/\n|\x1b\[\d+F/)) assert.ok(textWidth(line) < 60, line);
});

test("both views estimate serial native runs plus parallel web runs", () => {
  const native = ["android", "ios", "desktop"].map((target) => ({ id: target, name: target, resolvedTarget: resolveScenarioTarget({ target }, {}, {}, process.cwd()) }));
  for (const View of [PlainView, LiveView]) {
    for (const mixed of [false, true]) {
      const out = sink(240);
      const view = new View(out, { color: false });
      const web = Array.from({ length: 4 }, (_, i) => ({ id: `web-${i}`, name: "Web" }));
      view.plan({ ...plan, run: mixed ? [...native, ...web] : native, cached: [], concurrency: 3 });
      view.close();
      const text = stripAnsi(out.text);
      assert.match(text, mixed ? /3 web at a time, other targets 1 at a time, so 5 to 20 minutes/ : /1 at a time, so 3 to 12 minutes/);
    }
  }
});

test("a narrow terminal still gets lines that fit", () => {
  const out = sink(24);
  const view = new LiveView(out, { color: false, now: () => 0 });
  view.plan(plan);
  view.start();
  view.event({ type: "started", id: "free-shipping" });
  view.event({ type: "step", id: "free-shipping", step: { step: 1, status: "running", remark: "navigate: a long remark that cannot fit", ts: "" } });
  view.draw();
  view.close();
  for (const line of out.text.replace(/\x1b\[\d+F\x1b\[J|\x1b\[\?25[lh]/g, "\n").split("\n")) assert.ok(textWidth(line) < 24, JSON.stringify(line));
});

test("with --json the progress view leaves the details, the summary and errors to the document", () => {
  const out = sink(200);
  const view = new PlainView(out, { color: false, now: () => 0, brief: true });
  view.plan(plan);
  view.start();
  view.event({ type: "started", id: "free-shipping" });
  view.event({ type: "finished", id: "free-shipping", result: failed.result });
  view.done(doc);
  view.fail({ ok: false, exitCode: 3, error: { code: "x", message: "broken", fix: "fix it" } });
  assert.match(out.text, /failed free-shipping/);
  assert.doesNotMatch(out.text, /Kane saw|Re-run what broke|broken/);
});

test("a build that fails leaves no scenario rows, and nothing is drawn after the view closed", () => {
  const out = sink(80);
  const view = new LiveView(out, { color: false, now: () => 0 });
  view.plan(plan);
  view.phase("Building the app: pnpm build");
  view.fail({ ok: false, exitCode: 3, error: { code: "build_failed", message: "The build failed.", fix: "Make the build pass." } });
  assert.doesNotMatch(stripAnsi(out.text), /waiting/);
  const closed = out.text;
  // A resize after the end must not erase the error above the prompt.
  view.draw();
  assert.equal(out.text, closed);
});

test("both views label Kane's opinion on a refuted check and give a conditional next step", () => {
  const disputed = buildDoc({ items: [refuted()], skipped: [], base: null, changedFiles: null, url: null, seconds: 122, out: "/out", rerun: { flags: [] }, estimatedCredits: 30 });
  for (const View of [PlainView, LiveView]) {
    const out = sink(160);
    const view = new View(out, { color: false });
    view.done(disputed);
    assert.match(out.text, /✗ Free shipping from €50 failed/);
    assert.match(out.text, /Why +The scenario's check did not hold on the page\. Kane believes the scenario is out of date\./);
    assert.match(out.text, /Kane thinks +The test used the wrong/);
    assert.match(out.text, /Next +If the change in the app was intended, update the scenario; otherwise fix the app\./);
    assert.doesNotMatch(out.text, /Suggestion|Update the test expectation/);
  }
});

test("zero reported credits does not claim an unfinished run was free", () => {
  const interrupted = buildDoc({ items: [ran("x", "error")], skipped: [], base: null, changedFiles: null, url: null, seconds: 11, out: "/out", rerun: { flags: [] }, estimatedCredits: 30 });
  const text = ending(interrupted, palette(false)).join("\n");
  assert.match(text, /no credits reported/);
  assert.match(text, /account debit can be higher/);
  assert.doesNotMatch(text, /0 credits/);
});

test("a run of cached passes alone cost nothing, and says so", () => {
  const cached = buildDoc({ items: [{ scenario: ran("x", "passed").scenario, cached: { key: "k", passedAt: "2026-11-16T10:00:00.000Z" } }], skipped: [], base: null, changedFiles: null, url: null, seconds: 0, out: "/out", rerun: { flags: [] }, estimatedCredits: 0 });
  const text = ending(cached, palette(false)).join("\n");
  assert.match(text, /✓ 1 passed · 0 credits · 0s/);
  assert.doesNotMatch(text, /reported|balance/);
});
