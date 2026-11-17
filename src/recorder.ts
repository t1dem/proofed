import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VISIBLE_TEXT } from "./textcheck.ts";
import { connectCdp, type ScreencastMetadata, type TargetInfo } from "./cdp.ts";
import type { LiveCursor } from "./livefile.ts";

export type Rect = { x: number; y: number; width: number; height: number };
// `scale` turns page (CSS) pixels into pixels of this frame's image.
// `bytes` is the JPEG size, a cheap hint of how much changed since the previous frame.
export type Frame = { file: string; time: number; scale: number; width: number; height: number; bytes: number };
// What Kane did on the page, in CSS pixels of the viewport at that moment.
export type Action = { kind: "click" | "type"; time: number; x: number; y: number; rect: Rect };
// A still for the live view, with where Kane last clicked or typed when it shows that same page.
// `at`: the moment it shows the page as of (Date.now()), so an older still never replaces a newer one.
export type Still = { jpeg: Uint8Array; at: number; cursor?: LiveCursor };
// The page an action was on: its document, address, scroll and viewport size.
type Page = { doc: number; href: string; sx: number; sy: number; w: number; h: number };
const PAGE = `({ doc: performance.timeOrigin, href: location.href, sx: scrollX, sy: scrollY, w: innerWidth, h: innerHeight })`;

const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;
// The largest frame Proofed's server takes (MAX_FRAME in site/src/worker/live.ts).
const MAX_LIVE_FRAME = 400_000;
const BINDING = "__proofedAction";

// Runs in every page Kane opens. It only listens: Kane's clicks and typing are reported back
// through a CDP binding so the clip can draw a cursor and zoom to where things happen.
// It also says which page the action was on, so the live view only draws a cursor over the same
// page as it was then.
const LISTENER = `(() => {
  const report = (kind, x, y, el) => {
    const r = el.getBoundingClientRect();
    const page = ${PAGE};
    globalThis.${BINDING}?.(JSON.stringify({ kind, time: Date.now() / 1000, x, y, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, page }));
  };
  let pointerAt = 0;
  let typingIn = null;
  let clicked = null;
  addEventListener("pointerdown", (e) => {
    if (!e.isTrusted || !(e.target instanceof Element)) return;
    pointerAt = Date.now();
    typingIn = null;
    clicked = { el: e.target, x: e.clientX, y: e.clientY };
    report("click", e.clientX, e.clientY, e.target);
  }, true);
  // A click dispatched from script has no pointer events before it: place it on the element.
  addEventListener("click", (e) => {
    if (Date.now() - pointerAt < 500 || !(e.target instanceof Element)) return;
    const r = e.target.getBoundingClientRect();
    clicked = { el: e.target, x: r.x + r.width / 2, y: r.y + r.height / 2 };
    report("click", clicked.x, clicked.y, e.target);
  }, true);
  // Typing in the field Kane just clicked stays at the click point, still inside the field unless it
  // scrolled away; its centre would make the cursor jump a few pixels within the same field.
  addEventListener("input", (e) => {
    if (!(e.target instanceof Element) || e.target === typingIn) return;
    typingIn = e.target;
    const r = e.target.getBoundingClientRect();
    const at = clicked?.el === e.target && clicked.x >= r.left && clicked.x <= r.right && clicked.y >= r.top && clicked.y <= r.bottom
      ? clicked
      : { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    report("type", at.x, at.y, e.target);
  }, true);
})();`;

// Finds the smallest visible element that mentions most of the given words, so the end of the
// clip can settle on what the final check was about (a total, a confirmation message).
const LOCATE = (words: string[]) => `(() => {
  const words = ${JSON.stringify(words)};
  const vw = innerWidth, vh = innerHeight;
  let best = null;
  for (const el of document.body?.querySelectorAll("*") ?? []) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
    const area = r.width * r.height;
    if (area > vw * vh * 0.4) continue;
    const text = (el.innerText ?? "").toLowerCase().replace(/[‘’]/g, "'");
    const hits = words.filter((w) => text.includes(w)).length;
    if (hits && (!best || hits > best.hits || (hits === best.hits && area < best.area))) {
      best = { hits, area, el, rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
    }
  }
  if (!best || best.hits < Math.min(2, words.length)) return null;
  // Tighten to the text itself: a block is often page-wide while its words sit on the left.
  let box = null;
  const walker = document.createTreeWalker(best.el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    box = box
      ? { left: Math.min(box.left, r.left), top: Math.min(box.top, r.top), right: Math.max(box.right, r.right), bottom: Math.max(box.bottom, r.bottom) }
      : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }
  return JSON.stringify(box ? { x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top } : best.rect);
})()`;

// A cursor drawn where an action was is only right on the same page, scrolled and sized the same:
// another document or address (a single-page app's route), a scroll or another layout and it would
// point at something else.
export const samePage = (a: Page, b: Page) =>
  a.doc === b.doc && a.href === b.href && Math.abs(a.sx - b.sx) < 2 && Math.abs(a.sy - b.sy) < 2 && a.w === b.w && a.h === b.h;

// Kane doesn't record video, so we attach to the same Chrome over CDP and keep every
// screencast frame with its timestamp. Frames are only sent when the page repaints,
// which is why the clip later replays them with their real durations.
export async function startRecorder(endpoint: string, outDir: string, targetId?: string) {
  mkdirSync(outDir, { recursive: true });
  const cdp = await connectCdp(endpoint);
  const frames: Frame[] = [];
  const actions: Action[] = [];
  let lastSession: string | undefined;
  let lastAction: (Action & { page: Page; session: string | undefined }) | undefined;
  // The latest screencast frame of each page. Chrome sends one on each repaint, so it shows the page
  // as it still is until the next comes in.
  const latest = new Map<string, { jpeg: Uint8Array; meta: ScreencastMetadata }>();

  let unexpectedPage = false;
  let onUnexpectedPage: (() => void) | undefined;
  const attached = new Set<string>();
  cdp.on("Target.targetCreated", ({ targetInfo }) => {
    if (targetId && targetInfo.type === "page" && targetInfo.targetId !== targetId) { unexpectedPage = true; onUnexpectedPage?.(); }
    if ((targetId && targetInfo.targetId !== targetId) || targetInfo.type !== "page" || attached.has(targetInfo.targetId)) return;
    attached.add(targetInfo.targetId);
    void cdp.send("Target.attachToTarget", { targetId: targetInfo.targetId, flatten: true }).catch(() => {});
  });

  const prepare = async (sessionId: string) => {
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Runtime.addBinding", { name: BINDING }, sessionId);
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: LISTENER }, sessionId);
    if (targetId) await cdp.send("Runtime.evaluate", { expression: LISTENER }, sessionId);
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: MAX_WIDTH, maxHeight: MAX_HEIGHT }, sessionId);
  };
  let firstPage: (info: TargetInfo) => void = () => {};
  const ready = new Promise<TargetInfo>((resolve) => (firstPage = resolve));
  cdp.on("Target.attachedToTarget", ({ sessionId, targetInfo }) => {
    if (targetInfo.type !== "page" || (targetId && targetInfo.targetId !== targetId)) return;
    prepare(sessionId).then(
      () => firstPage(targetInfo),
      () => {}, // The page closed while we were setting it up.
    );
  });

  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId: ack }, sessionId) => {
    const file = join(outDir, `${String(frames.length).padStart(5, "0")}.jpg`);
    const jpeg = Buffer.from(data, "base64");
    writeFileSync(file, jpeg);
    const scale = Math.min(1, MAX_WIDTH / metadata.deviceWidth, MAX_HEIGHT / metadata.deviceHeight);
    frames.push({
      file,
      time: metadata.timestamp,
      scale,
      width: Math.round(metadata.deviceWidth * scale),
      height: Math.round(metadata.deviceHeight * scale),
      bytes: jpeg.length,
    });
    lastSession = sessionId;
    if (sessionId) latest.set(sessionId, { jpeg, meta: metadata });
    void cdp.send("Page.screencastFrameAck", { sessionId: ack }, sessionId).catch(() => {});
  });

  cdp.on("Runtime.bindingCalled", ({ name, payload }, sessionId) => {
    if (name !== BINDING) return;
    const { page, ...action } = JSON.parse(payload) as Action & { page: Page };
    actions.push(action);
    lastAction = { ...action, page, session: sessionId };
    recorder.onAction?.(before(lastAction));
  });

  // The page's last screencast frame, picked as the action is reported: it shows the very page Kane
  // clicked, even when the click then navigates, and frames of the next page only come in after it.
  // Only one of the same page, at the same viewport size and scroll, gets the cursor.
  const before = (action: NonNullable<typeof lastAction>): Still | undefined => {
    const frame = action.session ? latest.get(action.session) : undefined;
    if (!frame || frame.jpeg.length > MAX_LIVE_FRAME) return undefined;
    const { meta } = frame;
    const { page } = action;
    if (Math.round(meta.deviceWidth) !== page.w || Math.round(meta.deviceHeight) !== page.h) return undefined;
    if (Math.abs(meta.scrollOffsetX - page.sx) >= 2 || Math.abs(meta.scrollOffsetY - page.sy) >= 2) return undefined;
    return { jpeg: frame.jpeg, at: Date.now(), cursor: { x: action.x / page.w, y: action.y / page.h } };
  };

  await cdp.send("Target.setDiscoverTargets", { discover: true });
  // Don't let Kane navigate before the listener is installed on the starting tab.
  await Promise.race([ready, new Promise((r) => setTimeout(r, 5000))]);

  const recorder = {
    async visibleText(): Promise<string | undefined> {
      // The page is known from its first screencast frame, which can come after Kane's first step.
      for (let i = 0; !lastSession && i < 20; i++) await new Promise((r) => setTimeout(r, 100));
      if (!lastSession) return;
      try {
        const busy = new Promise<never>((_, reject) => setTimeout(reject, 5000).unref());
        const { result } = await Promise.race([cdp.send<{ result: { value?: unknown } }>("Runtime.evaluate", { expression: VISIBLE_TEXT, returnByValue: true }, lastSession), busy]);
        return typeof result.value === "string" ? result.value : undefined;
      } catch { return undefined; }
    },
    get unexpectedPage() { return unexpectedPage; },
    set onUnexpectedPage(callback: (() => void) | undefined) { onUnexpectedPage = callback; },
    frames,
    actions,
    // Called on each of Kane's clicks and the first keystroke in a field, with the frame from just
    // before it and the cursor on it, when there is a usable one.
    onAction: undefined as ((before: Still | undefined) => void) | undefined,
    async locate(words: string[]): Promise<Rect | undefined> {
      if (!lastSession || words.length === 0) return undefined;
      const { result } = await cdp
        .send<{ result: { value?: string | null } }>(
          "Runtime.evaluate",
          { expression: LOCATE(words), returnByValue: true },
          lastSession,
        )
        .catch(() => ({ result: {} as { value?: string | null } }));
      return result.value ? (JSON.parse(result.value) as Rect) : undefined;
    },
    // A still of what the page shows now, for the dashboard while the run is going (live.ts), with
    // the last action's cursor while the page is still the one it was on: a screenshot of its own, so
    // the page check after it holds for the picture. No clip or scale: Chrome shrinks a screenshot by
    // emulating a smaller viewport for it, and when Kane takes a screenshot at the same moment the
    // page is left at that size, in its narrow layout.
    async snapshot(): Promise<Still | undefined> {
      const session = lastSession;
      if (!session) return undefined;
      const action = lastAction;
      const at = Date.now();
      try {
        const { data } = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 60 }, session);
        const jpeg = Buffer.from(data, "base64");
        if (!action || action.session !== session) return { jpeg, at };
        // Asked after the screenshot: a page that is still the one of the action was showing during it.
        const { result } = await cdp.send<{ result: { value?: Page } }>("Runtime.evaluate", { expression: PAGE, returnByValue: true }, session);
        const now = result.value;
        return { jpeg, at, ...(now && samePage(action.page, now) && { cursor: { x: action.x / now.w, y: action.y / now.h } }) };
      } catch {
        return undefined; // The page is navigating or closed; the next one will do.
      }
    },
    stop() {
      cdp.close();
      return { frames, actions };
    },
  };
  return recorder;
}
