import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export type Step = { step: number; status: "running" | "done" | "failed"; remark: string; ts: string };

// The subset of Kane's `run_end` event (kane-cli 0.10, --agent NDJSON) that Proofed reads.
export type RunEnd = {
  type: "run_end";
  status: "passed" | "failed" | (string & {});
  reason?: string;
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
};

type KaneOptions = {
  objective: string;
  url: string;
  cdpEndpoint: string;
  username?: string;
  accessKey?: string;
  timeoutSeconds?: number;
  onStep?: (step: Step) => void;
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
  const proc = spawn(process.env.KANE_CLI ?? "kane-cli", args, { stdio: ["ignore", "pipe", "pipe"] });

  const steps: Step[] = [];
  let end: RunEnd | undefined;
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d));

  createInterface({ input: proc.stdout }).on("line", (line) => {
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
    }
  });

  return new Promise((resolve) => proc.on("close", (exitCode) => resolve({ steps, end, exitCode, stderr })));
}
