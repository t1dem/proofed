import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findCrashes } from "./precheck.ts";

// Pages the way a bundler serves them: an empty root, filled in by a module script.
const page = (script: string) => `<!doctype html><body><div id="root"></div><script type="module" src="/${script}.js"></script></body>`;
const scripts: Record<string, string> = {
  // PR #3's bug: the module throws at load, so nothing ever renders.
  crash: `const name = "name: Free shipping".match(/^title: (.+)$/m)[1]; document.getElementById("root").textContent = name;`,
  ok: `document.getElementById("root").textContent = "Every pull request, run in Chrome";`,
  slow: `setTimeout(() => (document.getElementById("root").innerHTML = "<button>Add to bag</button>"), 1500);`,
  // Threw, and blank for a good while: a slow app with a broken script next to it, not a crash.
  late: `setTimeout(() => (document.getElementById("root").textContent = "Dashboard"), 6000); throw new Error("analytics failed");`,
  // Something on screen: a broken widget elsewhere on the page is for Kane to judge.
  noisy: `document.getElementById("root").textContent = "Shop"; throw new Error("analytics failed");`,
  // Blank but nothing thrown: maybe still loading, so it goes to Kane too.
  blank: ``,
};

test("only a page that threw and stays blank counts as crashed, with a screenshot of it", { timeout: 90_000 }, async () => {
  const server = createServer((req, res) => {
    const name = req.url!.slice(1).replace(/\.js$/, "");
    const js = req.url!.endsWith(".js");
    res.writeHead(200, { "content-type": js ? "text/javascript" : "text/html" });
    res.end(js ? scripts[name] : page(name));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const started = Date.now();
    const dir = mkdtempSync(join(tmpdir(), "proofed-precheck-"));
    const crashes = await findCrashes(Object.keys(scripts).map((name) => `${base}/${name}`), dir);
    assert.deepEqual([...crashes.keys()], [`${base}/crash`]);
    const crash = crashes.get(`${base}/crash`)!;
    assert.equal(crash.error, "TypeError: Cannot read properties of null (reading '1')");
    assert.ok(crash.screenshot?.startsWith(dir));
    // A JPEG starts with FF D8 FF.
    assert.deepEqual([...readFileSync(crash.screenshot!).subarray(0, 3)], [0xff, 0xd8, 0xff]);
    assert.ok(Date.now() - started < 30_000, "the check takes seconds, not minutes");
  } finally {
    server.close();
  }
});
