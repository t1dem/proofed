// The app didn't install, build or come up, so Kane never ran and there is no report to write.
// This says so on the PR, with the command that failed and the end of its output, posted or edited
// like a normal report; the dashboard reads "couldn't finish" as a blocked run. Its data carries the
// run history on, and has no failures, since nothing ran that the fixer could fix.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findReport, MARKER, setStatus } from "./github.ts";
import { ctx, env, putReport, readEvent } from "./pipeline.ts";
import { addRun, dataComment, readReportData, type ReportData } from "./report.ts";

export type Stage = "install" | "build" | "serve";

type Blocked = { stage: Stage; command: string; dir: string; url: string; log: string; runUrl?: string; sha: string; previous?: ReportData };

const LOG_LINES = 30;
// GitHub Actions colours its output; a comment would show the escape codes.
const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");

export function blockedReport({ stage, command, dir, url, log, runUrl, sha, previous }: Blocked) {
  const where = dir === "." ? "" : ` in \`${dir}/\``;
  const what =
    stage === "install"
      ? `\`${command}\`${where} failed`
      : stage === "build"
        ? `the build (\`${command}\`${where}) failed`
        : `\`${command}\`${where} didn't answer at ${url} within a minute`;
  let tail = plain(log).trim().split("\n").slice(-LOG_LINES).join("\n");
  // Actions masks console output, not files copied into a comment through the API.
  const secrets = ["GITHUB_TOKEN", "LT_ACCESS_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CODEX_API_KEY", "ACTIONS_ID_TOKEN_REQUEST_TOKEN"]
    .flatMap((name) => process.env[name] ? [process.env[name]!] : []);
  const token = process.env.GITHUB_TOKEN;
  if (token) secrets.push(Buffer.from(`x-access-token:${token}`).toString("base64"));
  for (const value of secrets.sort((a, b) => b.length - a.length)) tail = tail.replaceAll(value, "***");
  return [
    `${MARKER}\n### Proofed\n\nProofed couldn't finish this check: ${what}, so Kane had no app to open.`,
    tail ? `\`\`\`\n${tail}\n\`\`\`` : "The command printed nothing.",
    `If the command is wrong for this repository, change \`install\`, \`build\`, \`serve\` or \`working-directory\` in \`.github/workflows/proofed.yml\`.${runUrl ? ` [Workflow logs](${runUrl})` : ""}`,
  ].join("\n\n") + `\n${dataComment({ sha, failures: [], history: addRun(previous?.history, { sha, state: "error" }) })}`;
}

if (import.meta.main) {
  const { repo, runUrl } = ctx();
  const temp = env("RUNNER_TEMP");
  const read = (file: string) => (existsSync(join(temp, file)) ? readFileSync(join(temp, file), "utf8") : "");
  const stage = (read("proofed-stage").trim() || "install") as Stage;
  const command = env({ install: "PROOFED_INSTALL", build: "PROOFED_BUILD", serve: "PROOFED_SERVE" }[stage], stage);
  const number = Number(env("PROOFED_NUMBER"));
  const sha = env("PROOFED_SHA");
  const previous = repo ? readReportData((await findReport(repo, number))?.body ?? "") : undefined;
  const body = blockedReport({ stage, command, dir: env("PROOFED_DIR", "."), url: env("PROOFED_URL"), log: read("proofed-app.log"), runUrl, sha, previous });
  console.log(body);
  if (repo) {
    // Only a check runs this step: on a comment, it's the /proofed a person asked with.
    await putReport(repo, number, body, !!readEvent<{ comment: object }>().comment);
    await setStatus(repo, sha, "error", `The app didn't start (${stage}); Kane had nothing to check`, runUrl);
  }
}
