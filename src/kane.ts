import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export type Step = { step: number; status: "running" | "done" | "failed"; remark: string; ts: string };

// The subset of Kane's `run_end` event (kane-cli 0.10, --agent NDJSON) that Proofed reads.
export type RunEnd = {
  type: "run_end";
  status: "passed" | "failed" | (string & {});
  reason?: string;
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
};

type KaneOptions = {
  objective: string;
  url: string;
  cdpEndpoint: string;
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

export function runKane(o: KaneOptions): Promise<KaneResult> {
  const args = [
    "run",
    o.objective,
    "--agent",
    "--url",
    o.url,
    "--cdp-endpoint",
    o.cdpEndpoint,
    "--timeout",
    String(o.timeoutSeconds ?? 300),
    ...(o.username && o.accessKey ? ["--username", o.username, "--access-key", o.accessKey] : []),
  ];
  // Own process group: Kane spawns runner and Playwright children that outlive a plain kill.
  const proc = spawn(process.env.KANE_CLI ?? "kane-cli", args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
  const killGroup = (signal: NodeJS.Signals) => {
    try {
      if (proc.pid) process.kill(-proc.pid, signal);
    } catch {
      // Already gone.
    }
  };

  const steps: Step[] = [];
  let end: RunEnd | undefined;
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d));

  const lines = createInterface({ input: proc.stdout });
  const drained = new Promise((r) => lines.once("close", r));
  lines.on("line", (line) => {
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
  const watchdog = setTimeout(() => {
    timedOut = true;
    killGroup("SIGTERM");
    hardKill = setTimeout(() => killGroup("SIGKILL"), 5000);
  }, (o.wallTimeoutSeconds ?? 360) * 1000);

  // "exit", not "close": an orphaned grandchild can hold stdout open long after Kane is gone.
  return new Promise((resolve) =>
    proc.on("exit", async (exitCode) => {
      clearTimeout(watchdog);
      clearTimeout(hardKill);
      // Let the last lines (run_end) through, but don't wait on a stream an orphan keeps open.
      await Promise.race([drained, new Promise((r) => setTimeout(r, 2000))]);
      killGroup("SIGKILL");
      resolve({ steps, end, exitCode, stderr, timedOut });
    }),
  );
}
