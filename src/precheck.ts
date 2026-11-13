// Kane can't tell a page that crashed while loading from a slow one: on a blank page it waits,
// reloads and waits again, for minutes and dozens of credits, before it fails. So each start URL
// is opened once in headless Chrome first. A page that threw an uncaught exception and is still
// blank well after loading fails at once, without Kane. Anything less certain (blank but
// no exception, an exception but something on screen, a page that doesn't load) goes to Kane as
// before: this must never fail a healthy or a slow page.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { connectCdp, type Cdp, type ExceptionDetails } from "./cdp.ts";
import { launchChrome } from "./chrome.ts";
import type { ScenarioResult } from "./run.ts";
import { BLANK_PAGE } from "./runfile.ts";
import type { Scenario } from "./scenarios.ts";

const LOAD_TIMEOUT = 15_000;
// How long a loaded page gets to put something on screen.
const SETTLE = 3_000;
// A blank page that threw gets this much longer before it's called a crash: a slow app may still
// be about to render, and the exception may be someone else's (an analytics script).
const RECHECK = 10_000;
const POLL = 250;

// Any text, or an element that shows something without text.
const PAINTED = `(() => {
  const body = document.body;
  return !!body && (body.innerText.trim() !== "" || !!body.querySelector("img, svg, canvas, video, iframe, input, button"));
})()`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// A time limit that doesn't keep the process alive once the check is over.
const limit = (ms: number) => delay(ms, undefined, { ref: false });

// "TypeError: Cannot read properties of null (reading '1')", without the stack.
const message = (d: ExceptionDetails) =>
  (d.exception?.description ?? (d.exception?.value !== undefined ? String(d.exception.value) : d.text)).split("\n")[0]!.trim();

// The first uncaught exception, and a screenshot (JPEG file) of the page when it was judged blank.
export type Crash = { error: string; screenshot?: string };

// The URLs that crashed while loading. Screenshots go into `dir`.
export async function findCrashes(urls: string[], dir: string) {
  const crashes = new Map<string, Crash>();
  if (urls.length === 0) return crashes;
  mkdirSync(dir, { recursive: true });
  let chrome: Awaited<ReturnType<typeof launchChrome>> | undefined;
  const seconds = (from: number, to = Date.now()) => ((to - from) / 1000).toFixed(1);
  const started = Date.now();
  try {
    chrome = await launchChrome();
    const opened = Date.now();
    const cdp = await connectCdp(chrome.endpoint);
    await Promise.all(
      urls.map(async (url, i) => {
        const crash = await Promise.race([crashOf(cdp, url, join(dir, `crash-${i}.jpg`)), limit(LOAD_TIMEOUT + SETTLE + RECHECK + 5_000)]).catch(
          () => undefined,
        );
        if (crash) crashes.set(url, crash);
      }),
    );
    cdp.close();
    console.log(`Checked ${urls.length} start page(s) for a crash on load in ${seconds(started)} s (Chrome took ${seconds(started, opened)} s to start)`);
  } catch (e) {
    // The check is only a shortcut: without it, Kane runs every scenario as it always did.
    console.log(`Couldn't check the pages before Kane: ${e instanceof Error ? e.message : e}`);
  } finally {
    chrome?.close();
  }
  return crashes;
}

async function crashOf(cdp: Cdp, url: string, file: string): Promise<Crash | undefined> {
  const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
  const page = <T = unknown>(method: string, params: object = {}) => cdp.send<T>(method, params, sessionId);

  const errors: string[] = [];
  let loaded = () => {};
  const load = new Promise<void>((resolve) => (loaded = resolve));
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }, from) => from === sessionId && errors.push(message(exceptionDetails)));
  cdp.on("Page.loadEventFired", (_, from) => from === sessionId && loaded());
  await page("Page.enable");
  await page("Runtime.enable");

  const { errorText } = await page<{ errorText?: string }>("Page.navigate", { url });
  if (errorText) return undefined; // Not reachable at all: Kane reports that as it always has.
  await Promise.race([load, limit(LOAD_TIMEOUT)]);

  // `blank` only turns true on a definite answer; an evaluation lost to a navigation counts as unknown.
  let blank = false;
  let rechecking = false;
  for (let until = Date.now() + SETTLE; ; await sleep(POLL)) {
    const painted = await page<{ result: { value?: unknown } }>("Runtime.evaluate", { expression: PAINTED, returnByValue: true }).then(
      ({ result }) => result.value,
      () => undefined,
    );
    if (painted === true) return undefined;
    blank = painted === false;
    if (Date.now() < until) continue;
    if (rechecking || !blank || errors.length === 0) break;
    rechecking = true;
    until += RECHECK;
  }
  const error = blank ? errors[0] : undefined;
  if (!error) return undefined;
  // Without Kane there is no recording; this is the picture the report shows instead. A failed
  // screenshot only costs the picture, never the verdict.
  const screenshot = await page<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 80 }).then(
    ({ data }) => (writeFileSync(file, Buffer.from(data, "base64")), file),
    () => undefined,
  );
  return { error, screenshot };
}

// A normal failed result, so the report, the run file, the dashboard and the fixer need nothing new.
// The verdict is ours, in the shape Kane gives one. Kane never ran, so there are no steps or credits,
// and the clip is only the screenshot.
export function crashResult(scenario: Scenario, { error, screenshot }: Crash): ScenarioResult {
  return {
    scenario,
    outcome: "failed",
    steps: [],
    end: { type: "run_end", status: "failed", reason: BLANK_PAGE, verdict: { family: "application_issue", root_cause: error } },
    clip: screenshot ? { jpg: screenshot } : undefined,
    pageError: error,
  };
}
