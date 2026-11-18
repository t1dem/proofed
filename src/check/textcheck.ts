import type { Step } from "../kane/kane.ts";

// The final check, its text literals, and whether they were quoted. Quoted text is the author's own
// word for what the page shows; unquoted names are only taken from `Check that <A> contains <B>.`
// when they read as on-screen text, since a false contradiction turns a real pass into "not checked".
export type Expected = { check: string; literals: string[]; quoted: boolean };

const NEGATION = /\b(?:not|no|never|none|nothing|without|longer|cannot|neither|nor|hidden|gone|absent|missing|empty|removed|disappears?|disappeared)\b|n['’]t\b/i;
const QUOTED = /"([^"]+)"|“([^”]+)”|(?<![\p{L}\p{N}])'([^']+)'(?![\p{L}\p{N}])|‘([^’]+)’(?![\p{L}\p{N}])/gu;
// "list" alone is left out: in "Todo list contains Buy milk" it is a noun.
const VERB = /(?<=\s)(?:contains?|shows?|lists|includes?)(?=\s)/gi;
// Words of a description rather than of a label: "the cart", "Buy milk in the list", "now Free".
const DESCRIPTIVE = new Set(("the a an this that these those no one two three four five six seven eight nine ten each every all some any both several many its their his her it they them there " +
  "is are was were be been has have had and or but in on under beside next below above with without at after before again now still only then also which who when where while should must can will would visible displayed shown listed").split(" "));
// "Recent orders section" is a heading plus a description of it; which part the page shows is a guess.
const UI_NOUN = /^(?:section|list|page|panel|menu|heading|title|table|card|dialog|modal|button|field|tab|link|row|column|item|option|entry|entries|result|label|message|area|bar|sidebar|header|footer|toolbar|form|input|output|box|badge|banner|toast|tooltip|popup|view|screen|window|icon|image|chart|grid|tile|chip|cell)s?$/i;

function onScreen(phrase: string) {
  const words = phrase.split(/\s+/);
  // One capitalised word after "Check that" is as often a description ("Cart", "Sidebar") as a label.
  return /^\p{Lu}/u.test(phrase) && words.length >= 2 && words.length <= 6 && !/[,;:()[\]{}]/.test(phrase) &&
    !words.some((w) => DESCRIPTIVE.has(w.toLowerCase())) && !UI_NOUN.test(words.at(-1)!);
}

export function expectedText(objective: string): Expected {
  const lines = objective.trim().split("\n").map((l) => l.trim().replace(/\s*Stop after this (?:check|assertion)\.?$/i, "")).filter(Boolean);
  const quotes: string[] = [];
  const masked = (lines.at(-1) ?? "").replace(/^(?:\d+[.)]|[-*])\s+/, "").replace(QUOTED, (...m: string[]) => `\u0000${quotes.push(m.slice(1, 5).find((s) => s !== undefined)!) - 1}\u0000`);
  const sentence = masked.split(/(?<=[.!?])\s+/).at(-1) ?? "";
  const restore = (s: string) => s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `"${quotes[Number(i)]}"`);
  const check = restore(sentence);
  const body = /^(?:Check|Assert|Verify|Confirm|Ensure)(?: that)?\s+(.+?)\.?$/i.exec(sentence)?.[1];
  if (!body || NEGATION.test(body)) return { check, literals: [], quoted: false };
  const quoted = [...body.matchAll(/\u0000(\d+)\u0000/g)].map((m) => quotes[Number(m[1])]!.trim().replace(/[.,]+$/, "")).filter(Boolean);
  if (quoted.length) return { check, literals: [...new Set(quoted)], quoted: true };
  const verbs = [...body.matchAll(VERB)];
  if (verbs.length !== 1) return { check, literals: [], quoted: false };
  const at = verbs[0]!.index!;
  return { check, literals: [body.slice(0, at), body.slice(at + verbs[0]![0].length)].map((s) => s.trim()).filter(onScreen), quoted: false };
}

// Lenient on purpose: whitespace, case, quote and dash styles, and how an element splits text.
const squash = (text: string) => text.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[‘’ʼ]/g, "'").replace(/[“”«»„]/g, '"').replace(/[‐‑‒–—―−]/g, "-").replace(/\s+/gu, "");

export function textContradiction(expected: Expected, text: string | undefined): string | undefined {
  if (text === undefined) return;
  const missing = expected.literals.filter((literal) => !squash(text).includes(squash(literal)));
  if (!missing.length) return;
  const reason = `Proofed could not confirm Kane's pass: the page text had no ${missing.map((s) => JSON.stringify(s)).join(" or ")} when Kane made its final check.`;
  return expected.quoted ? reason : `${reason} The words were taken as on-screen text from the unquoted check ${JSON.stringify(expected.check)}; quote the exact text the page should show to say what to compare.`;
}

// Kane announces an assert, checks, then reports it done. The page is read at both moments and a
// literal counts as missing only when neither read has it, so text still rendering at the start
// or replaced right after does not contradict. Of several asserts, the last one naming every
// literal decides; when none names them (Kane paraphrased or translated), the last assert does.
export function assertSnapshots(expected: Expected, read: () => Promise<string | undefined>) {
  let chosen: { step: number; names: boolean; reads: Promise<string | undefined>[] } | undefined;
  return {
    step(s: Step) {
      if (!expected.literals.length || !/^assert:/i.test(s.remark)) return;
      if (s.status === "running") {
        const names = expected.literals.every((l) => squash(s.remark).includes(squash(l)));
        if (names || !chosen?.names) chosen = { step: s.step, names, reads: [read()] };
      } else if (chosen?.step === s.step && chosen.reads.length === 1) chosen.reads.push(read());
    },
    async text() {
      const reads = await Promise.all(chosen?.reads ?? []);
      return reads.length && reads.every((r) => r !== undefined) ? reads.join("\n") : undefined;
    },
  };
}

// Executed in the owned page. Text the DOM can't show (a canvas, a video, a plugin, a cross-origin
// frame, a closed shadow root) may hold the claimed words, so a page with any of them can't
// contradict. Images and icons can: their alt and labels are read, the pixels are not. A frame
// that is still loading shows the empty about:blank it started with, so it counts as unreadable.
export const VISIBLE_TEXT = `(() => {
  let complete = true;
  const parts = [document.title];
  const read = (root) => {
    parts.push(root instanceof ShadowRoot ? [...root.children].map((el) => el.innerText || '').join('\\n') : root.innerText || '');
    for (const el of [...(root instanceof Element ? [root] : []), ...root.querySelectorAll('*')]) {
      const view = el.ownerDocument.defaultView;
      if (!el.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) continue;
      const tag = el.localName;
      if (['canvas', 'video', 'object', 'embed'].includes(tag)) {
        const r = el.getBoundingClientRect();
        if (r.width > 1 && r.height > 1) complete = false;
      }
      if ((tag === 'input' && !['hidden', 'password'].includes(el.type)) || tag === 'textarea') parts.push(el.value, el.placeholder);
      if (tag === 'select') parts.push(...[...el.selectedOptions].map((o) => o.text));
      if (tag === 'img' || tag === 'area' || (tag === 'input' && el.type === 'image')) parts.push(el.alt);
      if (tag === 'svg') parts.push(...[...el.querySelectorAll('title')].map((t) => t.textContent));
      if (tag === 'text' && el instanceof view.SVGElement) parts.push(el.textContent);
      parts.push(el.getAttribute('aria-label'), el.getAttribute('title'));
      for (const pseudo of ['::before', '::after']) {
        const content = view.getComputedStyle(el, pseudo).content;
        if (!content || content === 'none' || content === 'normal') continue;
        if (/counter/.test(content)) complete = false;
        parts.push(content.replace(/attr\\(([\\w-]+)\\)/g, (_, name) => JSON.stringify(el.getAttribute(name) || '')).match(/"(?:[^"\\\\]|\\\\.)*"/g)?.map((s) => { try { return JSON.parse(s); } catch { return s.slice(1, -1); } }).join('') ?? '');
      }
      if (el.shadowRoot) read(el.shadowRoot);
      else if (view.customElements.get(tag)) complete = false;
      if (tag === 'iframe') {
        try {
          const doc = el.contentDocument, src = el.getAttribute('src');
          const loading = !doc || doc.readyState !== 'complete' || (src && !/^about:/i.test(src) && doc.URL === 'about:blank');
          if (!loading && doc.documentElement) read(doc.documentElement); else complete = false;
        }
        catch { complete = false; }
      }
    }
  };
  read(document.documentElement);
  return complete ? parts.filter(Boolean).join('\\n') : null;
})()`;
