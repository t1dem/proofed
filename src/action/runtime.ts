import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { env } from "../env.ts";
import { timedAsync } from "../timing.ts";
import { stopCheckServer } from "./app.ts";
import { collectCodex, removeBackground, startCodex, waitForCodex } from "./background.ts";
import { actionError, output, run, runBash, runnerFile } from "./command.ts";
import { installClaude, installCodex, useCodex } from "./tools.ts";

type Entry = "check" | "generate" | "fix";
const scripts: Record<Entry, string> = { check: "./cli.ts", generate: "../fix/generate.ts", fix: "../fix/fix.ts" };

export function runtimeEnv(entry: Entry, source: NodeJS.ProcessEnv) {
  const env: NodeJS.ProcessEnv = {
    ...source,
    PROOFED_OUT: source.RUNNER_TEMP ? `${source.RUNNER_TEMP}/proofed` : source.PROOFED_OUT,
    // Cold Chrome defaults used by TestMu's action on runners.
    KANE_CLI_CDP_TIMEOUT_MS: "60000",
    KANE_CLI_CDP_RETRIES: "2",
    KANE_CLI_USER_AGENT: "github-action",
  };
  if (entry !== "check" && env.PROOFED_CODEX_HOME) {
    env.CODEX_HOME = env.PROOFED_CODEX_HOME;
    delete env.CODEX_API_KEY;
  }
  return env;
}

async function runEntry(entry: Entry) {
  const childEnv = runtimeEnv(entry, process.env);
  if (entry !== "fix") output({ report: `${childEnv.PROOFED_OUT}/report.md` });
  await run(process.execPath, [fileURLToPath(new URL(scripts[entry], import.meta.url))], { env: childEnv }, "Proofed");
}

function writeAuth() {
  const dir = mkdtempSync(runnerFile("proofed-codex-auth."));
  try {
    chmodSync(dir, 0o700);
    const file = join(dir, "auth.json");
    writeFileSync(file, process.env.CODEX_AUTH_JSON ?? "", { mode: 0o600 });
    chmodSync(file, 0o600);
    output({ dir });
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

async function prepareAutofix() {
  if (process.env.PROOFED_URL) await stopCheckServer(process.env.PROOFED_URL);
  if (process.env.PROOFED_PROVIDER !== "codex") return timedAsync("tool install (Claude)", installClaude);
  const prefix = env("PROOFED_CODEX_DIR");
  if (process.env.PROOFED_CODEX_BACKGROUND) await waitForCodex(process.env.PROOFED_CODEX_BACKGROUND);
  else await timedAsync("tool install (Codex)", async () => output({ installed: await installCodex(prefix) }));
  useCodex(prefix);
}

if (import.meta.main) {
  try {
    const step = process.argv[2];
    switch (step) {
      case "check": case "generate": case "fix": await runEntry(step); break;
      case "login":
        await runBash("kane-cli", ["login", "--username", process.env.LT_USERNAME ?? "", "--access-key", process.env.LT_ACCESS_KEY ?? ""], { stdio: ["ignore", "inherit", "inherit"] });
        break;
      case "write-auth": writeAuth(); break;
      case "remove-auth": rmSync(env("PROOFED_CODEX_HOME"), { recursive: true, force: true }); break;
      case "start-codex": await startCodex(env("PROOFED_CODEX_DIR")); break;
      case "collect-codex": collectCodex(env("PROOFED_CODEX_BACKGROUND")); break;
      case "remove-background": removeBackground(env("PROOFED_CODEX_BACKGROUND")); break;
      case "prepare-autofix": await prepareAutofix(); break;
      default: throw new Error("Unknown action runtime step.");
    }
  } catch (e) { actionError(e); }
}
