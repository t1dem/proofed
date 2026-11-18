import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./actiontarget.ts", import.meta.url));

test("Actions requires a URL only for the selected web scenarios, including frontmatter-only targets", () => {
  const dir = mkdtempSync(join(tmpdir(), "proofed-action-target-"));
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" }).trim();
  try {
    mkdirSync(join(dir, ".proofed/scenarios"), { recursive: true });
    for (const [id, target] of [["mobile", "android"], ["desktop", "desktop"], ["web", "web"]]) {
      writeFileSync(join(dir, `.proofed/scenarios/${id}.md`), `---\nname: ${id}\ntarget: ${target}\npaths: [${id}.js]\nurl: /\n---\nAssert counter is 1.\n`);
      writeFileSync(join(dir, `${id}.js`), "old");
    }
    git("init", "-q", "-b", "main"); git("add", "-A"); git("commit", "-qm", "Initial fixture");
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(dir, "mobile.js"), "rebuilt"); git("commit", "-qam", "Change Android");
    const output = join(dir, "output");
    const env = { ...process.env, GITHUB_OUTPUT: output, GITHUB_TOKEN: "", GITHUB_EVENT_PATH: "", PROOFED_SCENARIOS: ".proofed/scenarios", PROOFED_TARGET: "", PROOFED_ONLY: "", PROOFED_URL: "", PROOFED_BASE_SHA: base, PROOFED_SHA: "HEAD" };
    const run = (extra: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [script], { cwd: dir, env: { ...env, ...extra }, encoding: "utf8" });
    const native = run();
    assert.equal(native.status, 0, native.stderr);
    assert.match(readFileSync(output, "utf8"), /web=false/);
    const desktop = run({ PROOFED_ONLY: "desktop" });
    assert.equal(desktop.status, 0, desktop.stderr);
    const mixed = run({ PROOFED_ONLY: "mobile,web" });
    assert.equal(mixed.status, 1);
    assert.match(mixed.stderr, /url is required for web checks/);
    const web = run({ PROOFED_ONLY: "web", PROOFED_URL: "http://127.0.0.1:4173" });
    assert.equal(web.status, 0, web.stderr);
    assert.match(readFileSync(output, "utf8"), /web=true/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
