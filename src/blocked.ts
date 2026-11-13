// The app didn't install, build or come up, so Kane never ran and there is no report to write.
// This says so on the PR, with the command that failed and the end of its output, in the same
// comment a normal report would use; the dashboard reads "couldn't finish" as a blocked run.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MARKER, setStatus, upsertComment } from "./github.ts";
import { ctx, env } from "./pipeline.ts";

export type Stage = "install" | "build" | "serve";

type Blocked = { stage: Stage; command: string; dir: string; url: string; log: string; runUrl?: string };

const LOG_LINES = 30;
// GitHub Actions colours its output; a comment would show the escape codes.
const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");

export function blockedReport({ stage, command, dir, url, log, runUrl }: Blocked) {
  const where = dir === "." ? "" : ` in \`${dir}/\``;
  const what =
    stage === "install"
      ? `\`${command}\`${where} failed`
      : stage === "build"
        ? `the build (\`${command}\`${where}) failed`
        : `\`${command}\`${where} didn't answer at ${url} within a minute`;
  const tail = plain(log).trim().split("\n").slice(-LOG_LINES).join("\n");
  return [
    `${MARKER}\n### Proofed\n\nProofed couldn't finish this check: ${what}, so Kane had no app to open.`,
    tail ? `\`\`\`\n${tail}\n\`\`\`` : "The command printed nothing.",
    `If the command is wrong for this repository, change \`install\`, \`build\`, \`serve\` or \`working-directory\` in \`.github/workflows/proofed.yml\`.${runUrl ? ` [Workflow logs](${runUrl})` : ""}`,
  ].join("\n\n");
}

if (import.meta.main) {
  const { repo, runUrl } = ctx();
  const temp = env("RUNNER_TEMP");
  const read = (file: string) => (existsSync(join(temp, file)) ? readFileSync(join(temp, file), "utf8") : "");
  const stage = (read("proofed-stage").trim() || "install") as Stage;
  const command = env({ install: "PROOFED_INSTALL", build: "PROOFED_BUILD", serve: "PROOFED_SERVE" }[stage], stage);
  const body = blockedReport({ stage, command, dir: env("PROOFED_DIR", "."), url: env("PROOFED_URL"), log: read("proofed-app.log"), runUrl });
  console.log(body);
  if (repo) {
    await upsertComment(repo, Number(env("PROOFED_NUMBER")), body);
    await setStatus(repo, env("PROOFED_SHA"), "error", `The app didn't start (${stage}); Kane had nothing to check`, runUrl);
  }
}
