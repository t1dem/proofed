import { executableCommand, killTree } from "../process.ts";
import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { creditMeter } from "./creditmeter.ts";
import { kaneSecretValues } from "./kaneauth.ts";
import { adopt } from "../children.ts";
import { maskSecrets } from "../secrets.ts";

export type Step = { step: number; status: "running" | "done" | "failed"; remark: string; ts: string };

// The subset of Kane's `run_end` event (kane-cli 0.10, --agent NDJSON) that Proofed reads.
export type RunEnd = {
  type: "run_end";
  status: "passed" | "failed" | (string & {});
  reason?: string;
  // Kane's own class of the ending, e.g. "infra_error.credits_exhausted" when the run never judged the app.
  reason_code?: string;
  final_state?: Record<string, unknown>;
  summary?: string;
  one_liner?: string;
  duration?: number;
  credits_consumed?: number;
  session_dir?: string;
  test_url?: string;
  verdict?: {
    family?: "automation_bug" | "product_bug" | (string & {});
    category?: string;
    root_cause?: string;
    bug_title?: string;
    suggestion?: string;
    confidence?: number;
  };
};

export type KaneResult = {
  steps: Step[];
  end: RunEnd | undefined;
  exitCode: number | null;
  stderr: string;
  timedOut: boolean;
  accountBalance?: { before: number; after: number; debit: number };
};

type KaneTarget =
  | { kaneArgs: string[]; url?: never; cdpEndpoint?: never }
  | { kaneArgs?: undefined; url: string; cdpEndpoint: string };

type KaneOptions = KaneTarget & {
  objective: string;
  rawFile?: string;
  signal?: AbortSignal;
  username?: string;
  accessKey?: string;
  timeoutSeconds?: number;
  wallTimeoutSeconds?: number;
  onStep?: (step: Step) => void;
  // Fires while the page is still in its final state, before Kane shuts down.
  onEnd?: (end: RunEnd) => void;
};

const isStep = (e: object): e is Step => "step" in e && "status" in e;
const isRunEnd = (e: object): e is RunEnd => "type" in e && e.type === "run_end";
const cancelled = (): KaneResult => ({ steps: [], end: undefined, exitCode: null, stderr: "Kane run cancelled", timedOut: false });

function diagnostic(file: string | undefined) {
  return (line: string) => {
    if (!file) return;
    try { appendFileSync(file, line); }
    catch { file = undefined; } // Keep reading Kane's verdict if its diagnostic file becomes unwritable.
  };
}

export async function runKane(o: KaneOptions): Promise<KaneResult> {
  if (o.signal?.aborted) return cancelled();
  const env = { ...process.env, ...(o.username && o.accessKey && { LT_USERNAME: o.username, LT_ACCESS_KEY: o.accessKey }) };
  const finish = await creditMeter(env);
  if (o.signal?.aborted) {
    await finish(false);
    return cancelled();
  }
  try {
    const result = await runUnmetered(o, kaneSecretValues(env));
    return { ...result, accountBalance: await finish() };
  } catch (e) { await finish(); throw e; }
}

function runUnmetered(o: KaneOptions, secrets: string[]): Promise<KaneResult> {
  const args = [
    "run",
    o.objective,
    "--agent",
    ...(o.kaneArgs ?? ["--target", "desktop", "--url", o.url, "--cdp-endpoint", o.cdpEndpoint]),
    "--timeout",
    String(o.timeoutSeconds ?? 300),
    ...(o.username && o.accessKey ? ["--username", o.username, "--access-key", o.accessKey] : []),
  ];
  // Own process group: Kane spawns runner and Playwright children that outlive a plain kill.
  const command = executableCommand(process.env.KANE_CLI ?? "kane-cli", args);
  const proc = spawn(command.file, command.args, { stdio: ["ignore", "pipe", "pipe"], detached: true, windowsHide: true });
  const killGroup = (signal: NodeJS.Signals) => killTree(proc.pid, signal);
  const release = adopt({ kill: killGroup, exited: new Promise((r) => proc.once("exit", r)) });

  const steps: Step[] = [];
  let end: RunEnd | undefined;
  let stderr = "";
  // Read complete lines so a credential split between process chunks is still masked.
  const errors = createInterface({ input: proc.stderr });
  const lines = createInterface({ input: proc.stdout });
  const drained = Promise.all([lines, errors].map((stream) => new Promise((r) => stream.once("close", r))));
  const writeStderr = diagnostic(o.rawFile && `${o.rawFile}.stderr`);
  const writeStdout = diagnostic(o.rawFile);
  errors.on("line", (line) => {
    const safe = maskSecrets(line, secrets) + "\n";
    stderr += safe;
    writeStderr(safe);
  });
  lines.on("line", (raw) => {
    const line = maskSecrets(raw, secrets);
    writeStdout(line + "\n");
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return; // Kane occasionally prints a non-JSON notice; it carries nothing we use.
    }
    if (typeof event !== "object" || event === null) return;
    if (isStep(event)) {
      steps.push(event);
      o.onStep?.(event);
    } else if (isRunEnd(event)) {
      end = event;
      o.onEnd?.(event);
    }
  });

  // Kane's own --timeout counts only active time; when its backend stalls a run can hang for
  // a quarter of an hour, so we also enforce a wall-clock limit.
  let timedOut = false;
  let hardKill: NodeJS.Timeout | undefined;
  const terminate = () => {
    if (hardKill) return;
    killGroup("SIGTERM");
    hardKill = setTimeout(() => killGroup("SIGKILL"), 5000);
  };
  const watchdog = setTimeout(() => {
    timedOut = true;
    terminate();
  }, (o.wallTimeoutSeconds ?? 360) * 1000);
  const abort = () => {
    clearTimeout(watchdog);
    terminate();
  };
  o.signal?.addEventListener("abort", abort, { once: true });
  if (o.signal?.aborted) abort();
  const clearTimers = () => {
    o.signal?.removeEventListener("abort", abort);
    clearTimeout(watchdog);
    clearTimeout(hardKill);
  };

  // "exit", not "close": an orphaned grandchild can hold stdout open long after Kane is gone.
  return new Promise((resolve) => {
    proc.once("error", (error) => { clearTimers(); release(); resolve({ steps, end, exitCode: null, stderr: maskSecrets(String(error), secrets), timedOut }); });
    proc.on("exit", async (exitCode) => {
      clearTimers();
      // Let the last lines (run_end) through, but don't wait on a stream an orphan keeps open.
      await Promise.race([drained, delay(2000, undefined, { ref: false })]);
      killGroup("SIGKILL");
      release();
      resolve({ steps, end, exitCode, stderr, timedOut });
    });
  });
}
