import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { publishClips, readFile, type Repo } from "./github.ts";
import { withGaveUpAttempt, type FixNote } from "./report.ts";
import { COMMENT_LIMIT, oneLine, readRunKey, runMarker } from "./reportdata.ts";
import { RUN_FILE, type RunFile } from "./runfile.ts";

export async function gaveUpReport({ body, repo, pr, brokenSha, outDir, runUrl }: {
  body: string;
  repo: Repo | undefined;
  pr: number;
  brokenSha: string;
  outDir: string;
  runUrl: string | undefined;
}, fix: FixNote, passing: string[]) {
  const names = passing.map((name) => `"${name}"`).join(", ");
  const attemptNote = names ? `Kane saw ${oneLine(names)} pass on the attempted fix.` : "";
  let report = withGaveUpAttempt(body, fix, attemptNote);
  const originalKey = readRunKey(body);
  if (repo && originalKey?.startsWith(`pr-${pr}/`)) {
    // An automatic fix can share the check's run ID. Keep the old archive and its clips intact.
    const fixKey = `pr-${pr}/${brokenSha.slice(0, 7)}-${process.env.GITHUB_RUN_ID ?? "local"}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}-fix`;
    const withRun = report.replace(runMarker(originalKey), () => runMarker(fixKey));
    if (withRun.length <= COMMENT_LIMIT) {
      try {
        const original = JSON.parse(await readFile(repo, `${originalKey}/${RUN_FILE}`, "proofed-clips")) as RunFile;
        if (original.sha === brokenSha && Array.isArray(original.scenarios)) {
          const local = join(outDir, RUN_FILE);
          writeFileSync(local, JSON.stringify({
            ...original, ...(runUrl && { runUrl }), fix: {
              status: "gave-up", model: fix.model, effort: fix.effort,
              summary: [fix.summary, attemptNote].filter(Boolean).join(" "), attempts: fix.tries,
            },
          } satisfies RunFile));
          await publishClips(repo, [{ path: `${fixKey}/${RUN_FILE}`, local }]);
          report = withRun;
        }
      } catch {
        console.log("Couldn't attach the fix attempts to the dashboard.");
      }
    }
  }
  writeFileSync(join(outDir, "report.md"), report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  return report;
}
