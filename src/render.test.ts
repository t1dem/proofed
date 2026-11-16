import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDoc } from "./result.ts";
import { colorOn, ending, LiveView, palette, PlainView, since, stripAnsi, textWidth, truncate, type Plan } from "./render.ts";
import { ran } from "./testing/results.ts";

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
      "[1:10] failed free-shipping: Free shipping from €50 (1:10, 27 credits)",
      "[1:10] passed promo: Promo code total (1:10, 25 credits)",
      "",
      "✗ Free shipping from €50 failed after 1:10",
      "  Kane saw    Shipping shows Free.",
      "  Diagnosis   The threshold is €40.",
      "  Failed step assert: shipping is €4.90",
      "  Clip        /out/x/clip.mp4",
      "  Scenario    .proofed/scenarios/free-shipping.md",
      "",
      "✗ 1 passed, 1 failed · 52 credits · 1m 14s",
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
    "✗ Free shipping from €50  1:10 · 27 credits",
    "✓ Promo code total  1:10 · 25 credits",
  ]);
  assert.equal(stripAnsi(out.text.slice(shown)).trim(), ending(doc, palette(false)).join("\n").trim());
  for (const line of stripAnsi(out.text).split(/\n|\x1b\[\d+F/)) assert.ok(textWidth(line) < 60, line);
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
