#!/usr/bin/env node
// A stand-in for kane-cli in tests, pointed to by KANE_CLI: takes the arguments src/kane/kane.ts passes
// and prints the NDJSON of `kane-cli run --agent`, at no credits. It opens --url in the Chrome at
// --cdp-endpoint, so the recording is of a real page.
//
// What it does is picked by a marker in the objective, else FAKE_KANE_MODE:
//   [fake:pass]        asserts and passes          [fake:fail]       a product bug
//   [fake:noassert]    passes without an assert    [fake:automation] blames the scenario text
//   [fake:refuted]     fails an assert but blames the scenario
//   [fake:flaky]       the same on the first run of an objective in FAKE_KANE_LOG, a pass after
//   [fake:error]       exits without a run_end     [fake:hang]       never finishes (with a child)
//   [fake:signedout]   refuses to run, as kane-cli does without a login (so does FAKE_KANE_SIGNED_IN=0)
//   [fake:nocredits]   ends at once as kane-cli does on an account without credits
//   [fake-from:name]   whatever the file FAKE_KANE_MODES/name says at the time of the run, so a test can
//                      have one scenario's outcome change between runs
// `balance` answers as kane-cli does: without a login or keys (FAKE_KANE_SIGNED_IN=0) it says so, and
// keys TestMu doesn't know (FAKE_KANE_KEYS=rejected) get its 401.
// [delay:ms] (FAKE_KANE_DELAY_MS) is the pause between steps, [credits:n] (FAKE_KANE_CREDITS) the
// credits it reports. Every call is appended to FAKE_KANE_LOG as a JSON line.
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { connectCdp } from "../targets/cdp.ts";

const args = process.argv.slice(2);
const record = (entry: object) => process.env.FAKE_KANE_LOG && appendFileSync(process.env.FAKE_KANE_LOG, `${JSON.stringify({ pid: process.pid, ...entry })}\n`);
record({ args });

if (args[0] === "--version") {
  if (process.env.FAKE_KANE_VERSION_WARNING) console.error(process.env.FAKE_KANE_VERSION_WARNING);
  console.log(process.env.FAKE_KANE_VERSION ?? "0.10.4");
  process.exit(0);
}
if (args[0] === "balance") {
  const keys = args.includes("--access-key");
  console.error("\nUpdate available: 0.10.3 → 0.10.4 — run `npm install -g @testmuai/kane-cli@latest` to update\n");
  if (keys && process.env.FAKE_KANE_KEYS === "rejected") {
    console.error('Error: Credit balance request failed: 401 {"error":"authentication failed"}');
    process.exit(1);
  }
  if (!keys && process.env.FAKE_KANE_SIGNED_IN === "0") {
    console.error('Not authenticated [prod]. Run "kane-cli login" first.');
    process.exit(2);
  }
  console.log(`Available credits: ${process.env.FAKE_KANE_BALANCE_FILE ? readFileSync(process.env.FAKE_KANE_BALANCE_FILE, "utf8").trim() : "1234.5"}`);
  process.exit(0);
}
if (args[0] !== "run") {
  console.error(`fake kane-cli: ${args[0]} is not faked`);
  process.exit(2);
}

const objective = args[1] ?? "";
const option = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const marker = (name: string) => new RegExp(`\\[${name}:([\\w.]+)\\]`).exec(objective)?.[1];
const from = /\[fake-from:([\w.-]+)\]/.exec(objective)?.[1];
const asked = (from && readFileSync(`${process.env.FAKE_KANE_MODES}/${from}`, "utf8").trim()) || marker("fake") || process.env.FAKE_KANE_MODE || "pass";
const ranBefore = () =>
  readFileSync(process.env.FAKE_KANE_LOG ?? "", "utf8")
    .split("\n")
    .filter((line) => line && (JSON.parse(line) as { args?: string[] }).args?.[1] === objective).length > 1;
const mode = asked === "flaky" ? (ranBefore() ? "pass" : "refuted") : asked;
const delay = Number(marker("delay") ?? process.env.FAKE_KANE_DELAY_MS ?? 50);
const credits = Number(marker("credits") ?? process.env.FAKE_KANE_CREDITS ?? 7);
const url = option("--url") ?? "about:blank";
const endpoint = option("--cdp-endpoint");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const emit = (event: object) => process.stdout.write(`${JSON.stringify(event)}\n`);
let n = 0;
async function step(remark: string, status: "done" | "failed" = "done") {
  n++;
  emit({ step: n, status: "running", remark, ts: new Date().toISOString() });
  await sleep(delay);
  emit({ step: n, status, remark, ts: new Date().toISOString() });
}

async function navigate() {
  if (!endpoint) return;
  const cdp = await connectCdp(endpoint);
  try {
    const { targetInfos } = await cdp.send<{ targetInfos: { targetId: string; type: string }[] }>("Target.getTargets");
    const page = targetInfos.find((t) => t.type === "page");
    if (!page) return;
    const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId: page.targetId, flatten: true });
    await cdp.send("Page.navigate", { url }, sessionId);
    await sleep(300);
  } finally {
    cdp.close();
  }
}

const end = (fields: object) => emit({ type: "run_end", duration: 1, credits_consumed: credits, ...fields });

if (mode === "signedout" || process.env.FAKE_KANE_SIGNED_IN === "0") {
  emit({ type: "stream_start", cli_version: "0.10.4", surface: "run", pid: process.pid, v: 1, ts: new Date().toISOString() });
  console.error("Not authenticated. Run: kane-cli login --oauth, or kane-cli login --username <user> --access-key <key>");
  process.exit(1);
}

await step(`navigate: Navigate to ${url}`);
await navigate().catch((e: unknown) => console.error(`fake kane-cli: couldn't open ${url}: ${e}`));

if (mode === "hang") {
  // Like Kane's runner and Playwright children: in its process group, outliving a plain kill.
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "fake-kane-child"], { stdio: "ignore" });
  record({ child: child.pid });
  emit({ step: ++n, status: "running", remark: "analyze: waiting for the page forever", ts: new Date().toISOString() });
  setInterval(() => {}, 1000);
} else if (mode === "error") {
  await step("analyze: looking at the page");
  console.error("fake kane-cli: the session ended unexpectedly");
  process.exit(1);
} else if (mode === "nocredits") {
  const reason = 'Credits exhausted: {"error":"insufficient credits"}';
  emit({ type: "run_end", status: "failed", summary: reason, reason, duration: 1, credits_consumed: 0, result_code: 560, reason_code: "infra_error.credits_exhausted" });
} else if (mode === "text") {
  await step(`assert: ${objective.split("\n")[0]}`);
  end({ status: "passed", reason: "Objective completed" });
} else if (mode === "noassert") {
  await step("wait: Waiting for the page to settle");
  end({ status: "passed", reason: "Objective completed", final_state: {} });
} else if (mode === "automation") {
  await step("analyze: looking for the Checkout button");
  end({
    status: "failed",
    reason: "The scenario asks for a Checkout button, and the page has none.",
    verdict: { family: "automation_bug", root_cause: "The objective names a button the app never had.", suggestion: "Name the button the page shows." },
  });
} else if (mode === "refuted") {
  await step("assert: shipping is €4.90 and the total is €49.40.");
  await step("assert: shipping is now Free and the total is €51.00.", "failed");
  end({
    status: "failed",
    reason: 'Final verification failed: "shipping is now Free and the total is €51.00."',
    verdict: {
      family: "automation_bug",
      root_cause: "The test used the wrong free-shipping threshold. The cart subtotal was €51.00, below the €60.00 threshold shown by the store.",
      suggestion: "Update the test expectation: shipping should remain €4.90 at a €51.00 subtotal.",
    },
  });
} else if (mode === "fail") {
  await step("analyze: reading the bag");
  await step("assert: shipping is €4.90", "failed");
  end({
    status: "failed",
    reason: process.env.FAKE_KANE_FAILURE_REASON ?? "Shipping shows “Free” for a €44.50 bag.",
    verdict: { family: "product_bug", root_cause: "The free shipping threshold is €40, not €50.", suggestion: "Compare against 50 in shipping()." },
  });
} else {
  await step("analyze: reading the heading");
  await step("assert: the heading says Shop");
  end({ status: "passed", reason: "Objective completed", summary: "The heading says Shop.", final_state: { heading: "Shop" } });
}
