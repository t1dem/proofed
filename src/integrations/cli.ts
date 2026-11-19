import { spawn } from "node:child_process";
import { addAbortListener } from "node:events";
import { adopt } from "../children.ts";
import type { DoctorCheck } from "../check/doctor.ts";
import { killTree } from "../process.ts";
import type { Doc, ErrorDoc, ScenarioDoc } from "../report/result.ts";
import { maskSecrets } from "../secrets.ts";

type Documents = {
  check: Doc | ErrorDoc;
  list: ErrorDoc | { exitCode: number; scenarios: { selected: boolean }[]; errors: { file: string; message: string }[] };
  doctor: ErrorDoc | { exitCode: number; checks: DoctorCheck[] };
};

export async function runCli<Command extends keyof Documents>(
  entry: string, command: Command, args: string[], cwd: string, signal: AbortSignal,
): Promise<Documents[Command]> {
  signal.throwIfAborted();
  // The check handles SIGTERM and cleans up the process groups it owns (Kane, Chrome and the app).
  const child = spawn(process.execPath, [entry, command, "--json", ...args], {
    cwd, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
  });
  let stdout = "";
  let startError: Error | undefined;
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.once("error", (error) => { startError = error; });
  const exited = new Promise<number | null>((resolve) => child.once("close", resolve));
  let escalation: NodeJS.Timeout | undefined;
  const terminate = () => {
    if (escalation) return;
    killTree(child.pid);
    escalation = setTimeout(() => killTree(child.pid, "SIGKILL"), 5000);
  };
  const release = adopt({ exited, kill: (signal) => signal === "SIGTERM" ? terminate() : killTree(child.pid, signal) });
  const abort = addAbortListener(signal, terminate);
  try {
    const code = await exited;
    signal.throwIfAborted();
    if (startError) throw startError;
    if (code !== 0 && code !== 1 && code !== 2 && code !== 3 && code !== 130) {
      throw new Error(`proofed ${command} exited unexpectedly (${code ?? "signal"}).`);
    }
    let doc: Documents[Command];
    try {
      doc = JSON.parse(stdout) as Documents[Command];
    } catch {
      throw new Error(`proofed ${command} returned invalid JSON.`);
    }
    if (doc?.exitCode !== code) throw new Error(`proofed ${command} returned an invalid result.`);
    return doc;
  } finally {
    abort[Symbol.dispose]();
    if (escalation) {
      clearTimeout(escalation);
      killTree(child.pid, "SIGKILL");
    }
    release();
  }
}

export function bounded(text: string, limit: number) {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export function observations({ reason, diagnosis }: ScenarioDoc, secrets: string[], limit = 1500) {
  const fieldLimit = reason && diagnosis ? Math.floor(limit / 2) : limit;
  return {
    ...(reason && { reason: bounded(maskSecrets(reason, secrets), fieldLimit) }),
    ...(diagnosis && { diagnosis: bounded(maskSecrets(diagnosis, secrets), fieldLimit) }),
  };
}
