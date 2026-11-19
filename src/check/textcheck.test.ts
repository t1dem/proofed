import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSnapshots, expectedText, textContradiction } from "./textcheck.ts";
import type { Step } from "../kane/kane.ts";

const literals = (objective: string) => expectedText(objective).literals;

test("an unquoted check of on-screen names is cross-checked", () => {
  const language = "1. Click the heart on the Token generator card in the All the tools section of the home page once.\n2. Check that Your favorite tools contains Token generator.\n3. Open the language selector currently showing English.\n4. Select Français.\n5. Check that Vos outils favoris contains Générateur de token.\nStop after this check.";
  assert.deepEqual(expectedText(language), { check: "Check that Vos outils favoris contains Générateur de token.", literals: ["Vos outils favoris", "Générateur de token"], quoted: false });
  assert.deepEqual(literals("Check that the favorites section lists Token generator."), ["Token generator"]);
  assert.deepEqual(literals("Check that Recent orders section shows Order 42."), ["Order 42"]);
});

test("quoted text anywhere in the final positive check is cross-checked", () => {
  assert.deepEqual(literals('Check that the page contains "Order complete".'), ["Order complete"]);
  assert.deepEqual(literals('Check that the page shows "Order complete".'), ["Order complete"]);
  assert.deepEqual(literals('Check that the text "Order complete" is visible.'), ["Order complete"]);
  assert.deepEqual(literals('Check that "Your cart" contains "French Press".'), ["Your cart", "French Press"]);
  assert.deepEqual(literals("Check that the report says “Free shipping from €0.50” and “Expected €4.90”, and that Kane's steps are listed."), ["Free shipping from €0.50", "Expected €4.90"]);
  assert.deepEqual(literals("Check that the badge reads 'Paused' and the title reads ‘Last run’."), ["Paused", "Last run"]);
  assert.deepEqual(literals('Open the bag. Check that this pull request says "Kane is checking this pull request again."'), ["Kane is checking this pull request again"]);
  assert.deepEqual(literals('3. Check that the total is "€81.90".\nStop after this check.'), ["€81.90"]);
  assert.deepEqual(literals('Check that the button says "Do not disturb".'), ["Do not disturb"]);
});

test("negative checks, descriptions and earlier lines are left to Kane", () => {
  const none = [
    'Check that "Buy milk" is no longer visible.',
    "Check that Buy milk is no longer visible in the todo list.",
    'Check that the page does not show "Error".',
    "Check that Error banner isn't shown.",
    "Assert that the menu items are no longer visible and the main menu is closed.",
    "Open the home page. Check that the main heading is visible and that the page shows no error message.",
    // From real scenarios: descriptions, values after "is", and verbs other than contains/shows/lists/includes.
    "Check that the inbox shows the sections Needs you, Kane is checking, Claude is fixing and Passed, in that order.",
    "Check that this pull request is now under Claude is fixing and says Claude is fixing Free shipping from €50.",
    "Check that the Before line says the page is blank and the After line says the main heading was visible.",
    "Check that the confirmation page says the order is in and that €17.90 was charged: €13.00 for the coffee plus €4.90 shipping, the total the bag showed. Any other amount on that page means the shop charged the wrong total.",
    "Check that shipping is now Free and the total is €51.00.",
    "Check that the discount is −€9.10, shipping is Free and the total is €81.90.",
    "Check that Buy milk is visible in the todo list.",
    "Check that the home page has a Your favorite tools section containing Token generator.",
    "Check that the home page displays a Your favorite tools section containing Token generator.",
    "Check that the topmost Total output beside Input text displays 7.",
    "Check that the main Total output is 7.",
    "Check that the zoom percentage changes and the rectangle visibly grows or shrinks.",
    "Assert the arrow is visible and joins both rectangles.",
    "Check that the heading reads Pricing and three plans are listed.",
    "Draw a large rectangle. The rectangle should have a translucent red fill. Both custom colors must render as red rather than black or an unfilled shape.",
    "Check that the cart shows Two bags.",
    "Check that the list shows Buy milk in the todo list.",
    "Check that Settings panel shows the dark mode toggle.",
    'Draw a "rectangle".',
    'Check that "Order complete" is shown.\nClick Continue.',
  ];
  for (const objective of none) assert.deepEqual(literals(objective), [], objective);
});

test("a contradiction names the missing text and how it was read", () => {
  const quoted = expectedText('Check that the page contains "Order complete".');
  assert.equal(textContradiction(quoted, undefined), undefined);
  assert.equal(textContradiction(quoted, "ORDER\n complete"), undefined);
  assert.equal(textContradiction(quoted, "Order\ncomplete"), undefined);
  assert.equal(textContradiction(quoted, ["Waiting", "Order complete"]), undefined);
  assert.match(textContradiction(quoted, ["Order", "complete"])!, /no "Order complete"/);
  assert.equal(textContradiction(expectedText('Check that the discount is "−€9.10".'), "Discount -€9.10"), undefined);
  assert.equal(textContradiction(quoted, "Other text"), `Proofed could not confirm Kane's pass: the page text had no "Order complete" when Kane made its final check.`);
  const unquoted = expectedText("Check that Vos outils favoris contains Générateur de token.");
  assert.equal(textContradiction(unquoted, "Vos outils favoris\nGénérateur de token"), undefined);
  const reason = textContradiction(unquoted, "Tous les outils\nGénérateur de token")!;
  assert.match(reason, /no "Vos outils favoris" when/);
  assert.doesNotMatch(reason, /"Générateur de token" when/);
  assert.match(reason, /unquoted check "Check that Vos outils favoris contains Générateur de token\."; quote the exact text/);
});

test("a disjunction needs one alternative and every surrounding conjunct", () => {
  const expected = expectedText('Check that the receipt says "Order total" and the status shows either "Paid" or "Pending".');
  assert.equal(textContradiction(expected, "Order total Paid"), undefined);
  assert.match(textContradiction(expected, "Order total Cancelled")!, /no "Paid" or "Pending"/);
  assert.match(textContradiction(expected, "Pending")!, /no "Order total"/);
  const list = expectedText('Check that the receipt says "Order total" and the status shows "Paid", "Pending", or "Reviewing".');
  assert.equal(textContradiction(list, "Order total Reviewing"), undefined);
  assert.match(textContradiction(list, "Pending")!, /no "Order total"/);
  assert.match(textContradiction(list, "Order total Cancelled")!, /no "Paid" or "Pending" or "Reviewing"/);
});

test("only the destination of a transition is expected in the final state", () => {
  const expected = expectedText('Check that the status changes from "Pending" to "Complete".');
  assert.deepEqual(expected.literals, ["Complete"]);
  assert.equal(textContradiction(expected, "Complete"), undefined);
  assert.match(textContradiction(expected, "Pending")!, /no "Complete"/);
  assert.deepEqual(literals('Check that the page shows a message from "Alice" to "Bob".'), ["Alice", "Bob"]);
});

test("the page is read at the start and end of the assert that decides", async () => {
  const expected = expectedText("Check that Vos outils favoris contains Générateur de token.");
  const step = (n: number, status: Step["status"], remark: string): Step => ({ step: n, status, remark, ts: "" });
  const page = { session: "tab", document: 1, href: "https://shop.test/cart" };
  const run = async (steps: Step[], pages: (string | undefined)[], replacement?: Partial<typeof page>) => {
    const reads: number[] = [];
    const snaps = assertSnapshots(expected, async () => {
      const i = reads.push(reads.length) - 1;
      const text = pages[i];
      if (text !== undefined) return { ...page, ...(i === 1 && replacement), text };
    });
    for (const s of steps) snaps.step(s);
    return { text: await snaps.text(), reads: reads.length };
  };
  const final = [step(1, "running", "assert: Vos outils favoris contains Générateur de token."), step(1, "done", "assert: Vos outils favoris contains Générateur de token.")];
  assert.deepEqual(await run(final, ["A", "B"]), { text: ["A", "B"], reads: 2 });
  assert.deepEqual(await run(final, ["A", undefined]), { text: undefined, reads: 2 }, "an unreadable page can't contradict");
  assert.deepEqual(await run(final, ["A", "B"], { session: "replacement" }), { text: undefined, reads: 2 });
  assert.deepEqual(await run(final, ["A", "B"], { document: 2 }), { text: undefined, reads: 2 });
  assert.deepEqual(await run(final, ["A", "B"], { href: "https://shop.test/checkout" }), { text: undefined, reads: 2 });
  assert.deepEqual(await run(final.slice(0, 1), ["A"]), { text: undefined, reads: 1 });
  // A later assert that doesn't name the literals doesn't replace one that does.
  assert.deepEqual(await run([...final, step(2, "running", "assert: the page is French"), step(2, "done", "assert: the page is French")], ["A", "B"]), { text: ["A", "B"], reads: 2 });
  const action = [step(2, "running", "click: Submit"), step(2, "done", "click: Submit")];
  const confirmation = [step(3, "running", "assert: the confirmation is visible"), step(3, "done", "assert: the confirmation is visible")];
  assert.deepEqual(await run([...final, ...action, ...confirmation], ["A", "B", "C", "D"]), { text: ["C", "D"], reads: 4 });
  assert.deepEqual(await run([...final, ...action, confirmation[1]!], ["A", "B"]), { text: undefined, reads: 2 });
  // Kane translated the check: the last assert decides.
  const translated = [step(1, "running", "assert: Your favorite tools contains Token generator"), step(1, "done", "assert: x"), step(2, "running", "assert: favorites contain the token generator"), step(2, "done", "assert: x")];
  assert.deepEqual(await run(translated, ["A", "B", "C", "D"]), { text: ["C", "D"], reads: 4 });
  assert.deepEqual(await run([step(1, "running", "click: the heart"), step(1, "done", "click: the heart")], []), { text: undefined, reads: 0 });
  const none = assertSnapshots(expectedText("Check that the heading is visible."), async () => ({ ...page, text: "page" }));
  none.step(final[0]!);
  assert.equal(await none.text(), undefined);
});

test("page text reads controls, labels, generated content and SVG; unreadable content stops a contradiction", async (t) => {
  const { launchChrome } = await import("../targets/chrome.ts");
  const { connectCdp } = await import("../targets/cdp.ts");
  const { VISIBLE_TEXT } = await import("./textcheck.ts");
  const chrome = await launchChrome({ headless: true });
  t.after(() => chrome.close());
  const cdp = await connectCdp(chrome.endpoint);
  try {
    const { targetInfos } = await cdp.send<{ targetInfos: { type: string; targetId: string }[] }>("Target.getTargets");
    const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId: targetInfos.find((t) => t.type === "page")!.targetId, flatten: true });
    const capture = async (html: string, script = "") => {
      await cdp.send("Runtime.evaluate", { expression: `document.body.innerHTML = ${JSON.stringify(html)}; ${script}` }, sessionId);
      const { result } = await cdp.send<{ result: { value: string | null } }>("Runtime.evaluate", { expression: VISIBLE_TEXT, returnByValue: true }, sessionId);
      return result.value;
    };
    const page = await capture(
      '<div>Order <span>complete</span></div><div id="host"></div><iframe></iframe>' +
        '<input value="Typed value"><input placeholder="Search tools"><textarea>Long note</textarea><select><option>First</option><option selected>Chosen option</option></select>' +
        '<img alt="Company logo" src="data:,"><button aria-label="Add to favorites">♥</button><span title="Tooltip text">?</span>' +
        '<svg width="40" height="20"><title>Chart title</title><text x="0" y="15">Svg label</text></svg>' +
        '<style>.tag::before { content: "Generated " attr(data-x); } .gone { display: none }</style><span class="tag" data-x="text"></span><span class="gone">Hidden words</span><span style="opacity:0"><b>Transparent words</b></span><input type="password" value="Secret pass">',
      `document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='Direct shadow text <span>Shadow text</span>'; document.querySelector('iframe').contentDocument.body.innerHTML='<span>Frame text</span>';`,
    );
    assert.notEqual(page, null, "images, SVG icons, form controls and CSS content don't make the capture incomplete");
    const expect = (literals: string[]) => ({ check: "", literals, quoted: true });
    assert.equal(textContradiction(expect(["Order complete", "Direct shadow text", "Shadow text", "Frame text", "Typed value", "Search tools", "Long note", "Chosen option", "Company logo", "Add to favorites", "Tooltip text", "Chart title", "Svg label", "Generated text"]), page!), undefined);
    for (const absent of ["Missing words", "Hidden words", "Transparent words", "Secret pass"]) assert.match(textContradiction(expect([absent]), page!)!, new RegExp(absent));
    const incomplete: [string, string?][] = [
      ['<canvas width="200" height="100"></canvas>'],
      ['<video width="200" height="100"></video>'],
      ['<iframe src="data:text/html,<p>Elsewhere</p>"></iframe>'],
      ['<closed-box></closed-box>', `if (!customElements.get('closed-box')) customElements.define('closed-box', class extends HTMLElement { constructor() { super(); this.attachShadow({mode:'closed'}).innerHTML = '<p>Inside</p>'; } }); document.body.innerHTML = '<closed-box></closed-box>';`],
      ['<ol><li class="n">Step</li></ol><style>.n::before { content: counter(list-item) ". "; }</style>'],
    ];
    for (const [html, script] of incomplete) assert.equal(await capture(html, script), null, html);
    assert.notEqual(await capture('<canvas width="0" height="0"></canvas><canvas style="display:none"></canvas><p>Text</p>'), null, "an invisible canvas holds no text");
  } finally {
    cdp.close();
  }
});

test("one capitalised word and the noun \"list\" are not taken as on-screen text", () => {
  assert.deepEqual(expectedText("Check that Cart contains Ethiopia Guji.").literals, ["Ethiopia Guji"]);
  assert.deepEqual(expectedText("Check that Inbox shows 3 unread.").literals, []);
  assert.deepEqual(expectedText("Check that Todo list contains Buy milk.").literals, ["Buy milk"]);
});
