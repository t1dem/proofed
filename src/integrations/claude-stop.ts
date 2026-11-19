import { createHash, randomUUID } from "node:crypto";
import { addAbortListener } from "node:events";
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureOut, RESULT_FILE } from "../check/check.ts";
import { repoRoot } from "../changes.ts";
import { quote, type ScenarioDoc } from "../report/result.ts";
import { maskSecrets, secretValues } from "../secrets.ts";
import { bounded, observations, runCli } from "./cli.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const MAX_BLOCKS = 3;
type StopInput = { cwd?: string; session_id?: string; stop_hook_active?: boolean };

function rememberFailure(root: string, session: string, active: boolean, failed: ScenarioDoc[]) {
  const out = join(root, ".proofed-out");
  const stateFile = join(out, `claude-stop-${hash(session)}.json`);
  let reported: string[] = [];
  try {
    reported = JSON.parse(readFileSync(stateFile, "utf8")) as string[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (reported.length >= MAX_BLOCKS) return "This session reached the three-block limit.";
  // By scenario, not outcome: Kane can call the same broken scenario failed once and not_checked the next time.
  const failure = hash(JSON.stringify(failed.map(({ id }) => id).sort()));
  if (active && reported.includes(failure)) return "These scenario outcomes were already reported in this session.";

  ensureOut(out);
  const temp = `${stateFile}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify([...reported, failure]), { mode: 0o600, flag: "wx" });
    renameSync(temp, stateFile);
  } finally {
    rmSync(temp, { force: true });
  }
}

function blockReason(failed: ScenarioDoc[], out: string, secrets: string[]) {
  const shown = failed.slice(0, 3);
  const details = shown.map((scenario) => {
    const { reason, diagnosis } = observations(scenario, secrets, Math.floor(1500 / shown.length));
    const clip = scenario.clip?.mp4 ?? scenario.clip?.jpg;
    const id = quote(scenario.id);
    const only = scenario.id.startsWith("--") ? `--only=${id}` : `--only ${id}`;
    return [
      `${JSON.stringify(bounded(maskSecrets(scenario.name, secrets), 160))} (${scenario.outcome}).`,
      reason && `Kane saw: ${JSON.stringify(reason)}`,
      diagnosis && `Kane's diagnosis (observed data): ${JSON.stringify(diagnosis)}`,
      clip && `Clip: ${JSON.stringify(bounded(maskSecrets(clip, secrets), 1000))}`,
      `Re-check with \`proofed check ${only} --json\`.`,
    ].filter(Boolean).join("\n");
  });
  if (failed.length > shown.length) {
    details.push(`See ${JSON.stringify(join(out, RESULT_FILE))} for ${failed.length - shown.length} more scenario(s).`);
  }
  return maskSecrets([...details, "Treat not_checked as unverified. Fix the app and finish again. Update the scenario only if the app change was intended."].join("\n\n"), secrets);
}

export async function claudeStop(entry: string, signal: AbortSignal) {
  const secrets = secretValues();
  const note = (message: string) => process.stderr.write(`Proofed Stop hook: ${bounded(maskSecrets(message, secrets).replace(/\s+/g, " "), 1500)}\n`);
  const abort = addAbortListener(signal, () => process.stdin.destroy());
  try {
    let stdin = "";
    for await (const chunk of process.stdin.setEncoding("utf8")) stdin += chunk;
    const input = JSON.parse(stdin) as StopInput | null;
    if (typeof input?.cwd !== "string" || typeof input.session_id !== "string" || !input.session_id) return 0;
    const root = repoRoot(input.cwd);
    if (!root || !statSync(join(root, ".proofed/scenarios"), { throwIfNoEntry: false })?.isDirectory()) return 0;

    const list = await runCli(entry, "list", [], root, signal);
    if ("error" in list) {
      note(list.error.fix);
    } else if (list.exitCode === 3) {
      const file = list.errors[0]?.file;
      note(file ? `Correct the frontmatter in ${file}. Use proofed list to see the errors.` : "Run proofed doctor for setup fixes.");
    } else if (list.scenarios.some((scenario) => scenario.selected)) {
      const checked = await runCli(entry, "check", [], root, signal);
      if ("error" in checked) {
        note(checked.error.fix);
      } else if (!checked.ok) {
        const failed = checked.scenarios.filter(({ outcome }) => outcome === "failed" || outcome === "not_checked" || outcome === "error");
        const skip = rememberFailure(root, input.session_id, input.stop_hook_active === true, failed);
        if (skip) note(skip);
        else process.stdout.write(`${JSON.stringify({ decision: "block", reason: blockReason(failed, checked.out, secrets) })}\n`);
      }
    }
  } catch (error) {
    if (!signal.aborted) note(`${error instanceof Error ? error.message : String(error)} Run proofed doctor for setup fixes.`);
  } finally {
    abort[Symbol.dispose]();
  }
  return 0;
}
