import { executableCommand } from "../process.ts";
import { pathValue } from "../which.ts";
// One headless Codex run, shared by the fixer and scenario writer.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fixer } from "./models.ts";

type Options = Fixer & { cwd?: string; timeoutMs?: number };
export type CodexAnswer = { ok: true; text: string } | { ok: false; message: string };

export function askCodex(prompt: string, o: Options): CodexAnswer {
  const dir = mkdtempSync(join(tmpdir(), "proofed-codex-"));
  try {
    const output = join(dir, "answer.txt");
    // The sandbox can't write the system temp dir. Without a temp dir of its own the agent
    // pointed TMPDIR at the repo, and tsx and Node caches ended up in the fix commit.
    const tmp = join(dir, "tmp");
    mkdirSync(tmp);
    // Keep job tokens and unrelated provider keys out of the agent process.
    const env = Object.fromEntries(
      ["PATH", "PATHEXT", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "USER", "TMPDIR", "TMP", "TEMP", "SystemRoot", "CODEX_HOME", "CODEX_API_KEY"]
        .flatMap((name) => pathValue(process.env, name) === undefined ? [] : [[name, pathValue(process.env, name)!]]),
    );
    // Codex has no equivalent of Claude's per-command/per-path tool allowlist. The sandbox
    // limits writes, blocks network and protects .git; the prompt restricts shell use to
    // reading code and the build. fix.ts/generate.ts undo edits outside their allowed files.
    // Ignore personal config/rules instead of inheriting personal MCP servers and permission overrides.
    const command = executableCommand("codex", [
      "exec", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--color", "never",
      "--sandbox", "workspace-write", "-c", 'approval_policy="never"',
      "-c", "sandbox_workspace_write.network_access=false",
      "-c", 'shell_environment_policy.inherit="none"',
      "-c", `shell_environment_policy.set.PATH=${JSON.stringify(env.PATH ?? "/usr/bin:/bin")}`,
      ...["TMPDIR", "TMP", "TEMP"].flatMap((name) => ["-c", `shell_environment_policy.set.${name}=${JSON.stringify(tmp)}`]),
      "-c", `sandbox_workspace_write.writable_roots=[${JSON.stringify(tmp)}]`,
      "-c", "sandbox_workspace_write.exclude_slash_tmp=true",
      "-c", "sandbox_workspace_write.exclude_tmpdir_env_var=true",
      "-c", `model_reasoning_effort=${JSON.stringify(o.effort)}`,
      "--model", o.model, "--json", "--output-last-message", output, "-",
    ], env);
    const run = spawnSync(command.file, command.args, {
      windowsHide: true, input: prompt, cwd: o.cwd, env, encoding: "utf8", maxBuffer: 50 * 1024 * 1024,
      timeout: o.timeoutMs ?? 10 * 60_000, killSignal: "SIGKILL",
    });
    if (run.error) {
      if ("code" in run.error && run.error.code === "ETIMEDOUT") return { ok: false, message: `Codex didn't finish within ${Math.round((o.timeoutMs ?? 600_000) / 60_000)} minutes` };
      return { ok: false, message: `Codex couldn't start: ${run.error.message}. Install @openai/codex and run codex login.` };
    }
    const errors: string[] = [];
    let failed = false;
    for (const line of run.stdout.split("\n")) {
      try {
        const event = JSON.parse(line) as { type?: string; message?: string; error?: { message?: string } };
        if (event.type === "turn.failed") failed = true;
        if (event.type === "error" || event.type === "turn.failed") errors.push(event.error?.message || event.message || "Codex turn failed");
      } catch { /* CLI diagnostics are not always JSON. */ }
    }
    const detail = [...errors, run.stderr.trim()].filter(Boolean).join("\n");
    if (run.status !== 0 || failed) {
      if (/usage limit|rate.limit|quota|429/i.test(detail)) return { ok: false, message: `Codex usage limit reached. Try again after it resets. ${detail}` };
      if (/model.*(?:not found|does not exist|not supported|not available|unavailable|unknown)|unknown model|model_not_found/i.test(detail)) return { ok: false, message: `The model \`${o.model}\` isn't available to this Codex account. ${detail}` };
      if (/not logged|unauthorized|401|authentication|api.key|sign.in|login required/i.test(detail)) return { ok: false, message: `Codex isn't logged in. Run codex login, or provide CODEX_API_KEY. ${detail}` };
      return { ok: false, message: detail || "Codex failed without an error message" };
    }
    let text = "";
    try { text = readFileSync(output, "utf8").trim(); } catch { /* No final message. */ }
    return text ? { ok: true, text } : { ok: false, message: "Codex finished without a final answer" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
