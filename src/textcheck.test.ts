import assert from "node:assert/strict";
import { test } from "node:test";
import { expectedText, textContradiction } from "./textcheck.ts";

test("only explicit quoted positive page text is cross-checked", () => {
  assert.deepEqual(expectedText('Check that the page contains "Order complete".'), ["Order complete"]);
  for (const objective of ['Check that Your favorite tools contains Token generator.', 'Check that "Buy milk" is no longer visible.', 'Check that the button is "red".', 'Draw a "rectangle".']) {
    assert.deepEqual(expectedText(objective), []);
  }
  assert.equal(textContradiction(["Order complete"], undefined), undefined);
  assert.equal(textContradiction(["Order complete"], "ORDER\n complete"), undefined);
  assert.match(textContradiction(["Order complete"], "Other text")!, /Order complete/);
});

test("page text includes split text, open shadow roots and same-origin frames", async () => {
  const { launchChrome } = await import('./chrome.ts');
  const { connectCdp } = await import('./cdp.ts');
  const { VISIBLE_TEXT } = await import('./textcheck.ts');
  const chrome = await launchChrome({ headless: true });
  const cdp = await connectCdp(chrome.endpoint);
  try {
    const { targetInfos } = await cdp.send<{ targetInfos: { type: string; targetId: string }[] }>('Target.getTargets');
    const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId: targetInfos.find(t => t.type === 'page')!.targetId, flatten: true });
    await cdp.send('Runtime.evaluate', { expression: `document.body.innerHTML = '<div>Order <span>complete</span></div><div id="host"></div><iframe></iframe>'; document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<span>Shadow text</span>'; document.querySelector('iframe').contentDocument.body.innerHTML='<span>Frame text</span>';` }, sessionId);
    const { result } = await cdp.send<{ result: { value: string } }>('Runtime.evaluate', { expression: VISIBLE_TEXT, returnByValue: true }, sessionId);
    assert.equal(textContradiction(['Order complete', 'Shadow text', 'Frame text'], result.value), undefined);
    assert.match(textContradiction(['Missing words'], result.value)!, /Missing words/);
  } finally { cdp.close(); await chrome.close(); }
});
