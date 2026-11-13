import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connectCdp, type TargetInfo } from "./cdp.ts";

export type Rect = { x: number; y: number; width: number; height: number };
// `scale` turns page (CSS) pixels into pixels of this frame's image.
// `bytes` is the JPEG size, a cheap hint of how much changed since the previous frame.
export type Frame = { file: string; time: number; scale: number; width: number; height: number; bytes: number };
// What Kane did on the page, in CSS pixels of the viewport at that moment.
export type Action = { kind: "click" | "type"; time: number; x: number; y: number; rect: Rect };

const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;
const BINDING = "__proofedAction";

// Runs in every page Kane opens. It only listens: Kane's clicks and typing are reported back
// through a CDP binding so the clip can draw a cursor and zoom to where things happen.
const LISTENER = `(() => {
  const report = (kind, x, y, el) => {
    const r = el.getBoundingClientRect();
    globalThis.${BINDING}?.(JSON.stringify({ kind, time: Date.now() / 1000, x, y, rect: { x: r.x, y: r.y, width: r.width, height: r.height } }));
  };
  let pointerAt = 0;
  let typingIn = null;
  addEventListener("pointerdown", (e) => {
    if (!e.isTrusted || !(e.target instanceof Element)) return;
    pointerAt = Date.now();
    typingIn = null;
    report("click", e.clientX, e.clientY, e.target);
  }, true);
  // A click dispatched from script has no pointer events before it: place it on the element.
  addEventListener("click", (e) => {
    if (Date.now() - pointerAt < 500 || !(e.target instanceof Element)) return;
    const r = e.target.getBoundingClientRect();
    report("click", r.x + r.width / 2, r.y + r.height / 2, e.target);
  }, true);
  addEventListener("input", (e) => {
    if (!(e.target instanceof Element) || e.target === typingIn) return;
    typingIn = e.target;
    const r = e.target.getBoundingClientRect();
    report("type", r.x + r.width / 2, r.y + r.height / 2, e.target);
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

// Kane doesn't record video, so we attach to the same Chrome over CDP and keep every
// screencast frame with its timestamp. Frames are only sent when the page repaints,
// which is why the clip later replays them with their real durations.
export async function startRecorder(endpoint: string, outDir: string) {
  mkdirSync(outDir, { recursive: true });
  const cdp = await connectCdp(endpoint);
  const frames: Frame[] = [];
  const actions: Action[] = [];
  let lastSession: string | undefined;

  const attached = new Set<string>();
  cdp.on("Target.targetCreated", ({ targetInfo }) => {
    if (targetInfo.type !== "page" || attached.has(targetInfo.targetId)) return;
    attached.add(targetInfo.targetId);
    void cdp.send("Target.attachToTarget", { targetId: targetInfo.targetId, flatten: true }).catch(() => {});
  });

  const prepare = async (sessionId: string) => {
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Runtime.addBinding", { name: BINDING }, sessionId);
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: LISTENER }, sessionId);
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: MAX_WIDTH, maxHeight: MAX_HEIGHT }, sessionId);
  };
  let firstPage: (info: TargetInfo) => void = () => {};
  const ready = new Promise<TargetInfo>((resolve) => (firstPage = resolve));
  cdp.on("Target.attachedToTarget", ({ sessionId, targetInfo }) => {
    if (targetInfo.type !== "page") return;
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
    void cdp.send("Page.screencastFrameAck", { sessionId: ack }, sessionId).catch(() => {});
  });

  cdp.on("Runtime.bindingCalled", ({ name, payload }) => {
    if (name === BINDING) actions.push(JSON.parse(payload) as Action);
  });

  await cdp.send("Target.setDiscoverTargets", { discover: true });
  // Don't let Kane navigate before the listener is installed on the starting tab.
  await Promise.race([ready, new Promise((r) => setTimeout(r, 5000))]);

  return {
    frames,
    actions,
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
    stop() {
      cdp.close();
      return { frames, actions };
    },
  };
}
