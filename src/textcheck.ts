// Only explicit positive text-presence checks have a DOM interpretation. Other claims,
// including unquoted names, negative checks and visual properties, remain Kane's decision.
export function expectedText(objective: string): string[] {
  const last = objective.trim().replace(/\s*Stop after this check\.?\s*$/i, "").split("\n").at(-1)?.trim() ?? "";
  const match = /^(?:\d+\.\s*)?Check that (?:the (?:page|screen) (?:contains|shows) (?:the text )?|(?:the text ))["“]([^"“”]+)["”](?: is visible(?: on the page)?)?\.$/i.exec(last);
  return match ? [match[1]!] : [];
}

const normalize = (text: string) => text.normalize("NFC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();

export function textContradiction(expected: string[], text: string | undefined): string | undefined {
  if (text === undefined) return;
  const missing = expected.filter((literal) => !normalize(text).includes(normalize(literal)));
  if (missing.length) return `Proofed could not confirm Kane's pass: visible page text did not contain ${missing.map((s) => JSON.stringify(s)).join(", ")} when the final assert arrived.`;
}

// Executed in the owned page at the assert event, not at run_end. A canvas or an
// unreadable subtree can contain the claimed text, so absence there is inconclusive.
export const VISIBLE_TEXT = `(() => {
  let complete = true;
  const read = (root) => {
    let text = root.innerText || '';
    for (const el of root.querySelectorAll('*')) {
      if (!el.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) continue;
      if (['CANVAS', 'IMG', 'VIDEO', 'SVG', 'OBJECT', 'EMBED'].includes(el.tagName.toUpperCase())) complete = false;
      if (el.shadowRoot) text += '\\n' + read(el.shadowRoot);
      else if (el.localName.includes('-')) complete = false;
      if (el.tagName === 'IFRAME') {
        try { if (el.contentDocument?.body) text += '\\n' + read(el.contentDocument.body); else complete = false; }
        catch { complete = false; }
      }
    }
    if (root instanceof ShadowRoot) text += '\\n' + [...root.children].map(el => el.innerText || '').join('\\n');
    return text;
  };
  const text = read(document.body);
  return complete ? text : null;
})()`;
