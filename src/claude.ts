// One headless Claude Code run, for the fixer (fix.ts) and for the setup PR's scenarios (generate.ts).
import { spawnSync } from "node:child_process";
import type { Fixer } from "./models.ts";

type ClaudeOutput = { result?: string; is_error?: boolean; api_error_status?: number };

type Options = Fixer & {
  // Claude Code's --allowedTools: what runs without asking. In -p mode nothing can ask, so the rest is refused.
  allowedTools: string[];
  // Claude Code's --tools: the only tools it has at all, when narrower than the default set.
  tools?: string[];
  permissionMode?: "acceptEdits" | "default";
  maxTurns?: number;
  timeoutMs?: number;
};

export type ClaudeAnswer = { ok: true; text: string } | { ok: false; message: string };

export function askClaude(prompt: string, o: Options): ClaudeAnswer {
  const run = spawnSync(
    "claude",
    ["-p", prompt, "--output-format", "json", "--permission-mode", o.permissionMode ?? "acceptEdits", "--max-turns", String(o.maxTurns ?? 40),
      "--model", o.model, "--effort", o.effort,
      ...(o.tools ? ["--tools", o.tools.join(",")] : []),
      "--allowedTools", o.allowedTools.join(",")],
    { encoding: "utf8", maxBuffer: 50 * 1024 * 1024, timeout: o.timeoutMs, killSignal: "SIGKILL" },
  );
  if (run.error && "code" in run.error && run.error.code === "ETIMEDOUT") {
    return { ok: false, message: `Claude Code didn't finish within ${Math.round((o.timeoutMs ?? 0) / 60_000)} minutes` };
  }
  let parsed: ClaudeOutput = {};
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    // No JSON at all: Claude Code itself failed to start.
  }
  const text = parsed.result?.trim() ?? "";
  // Usage limits and API errors come back as is_error with the message in `result`.
  if (parsed.api_error_status === 404) return { ok: false, message: `the model \`${o.model}\` isn't available to this Claude account` };
  if (run.status !== 0 || parsed.is_error) return { ok: false, message: text || run.stderr?.trim() || "Claude Code failed" };
  return { ok: true, text };
}
