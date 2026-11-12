import { MARKER } from "./github.ts";
import type { ScenarioResult } from "./run.ts";

export type ClipLinks = { gif?: string; mp4?: string };

// What the fix workflow needs to know about a failure, kept in the comment itself
// so the fix run doesn't depend on artifacts from another workflow.
export type FailureData = { id: string; name: string; file: string; objective: string; reason: string; diagnosis: string };
export type ReportData = { sha: string; failures: FailureData[] };

const DATA_RE = /<!-- proofed:data (.*?) -->/s;
export const FIX_BOX = "Fix with Claude";

export function readReportData(body: string): ReportData | undefined {
  const raw = DATA_RE.exec(body)?.[1];
  return raw ? (JSON.parse(raw) as ReportData) : undefined;
}

export const fixRequested = (body: string) => body.includes(`- [x] **${FIX_BOX}**`);

const quote = (text = "") =>
  text
    .trim()
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");

function clip(links: ClipLinks | undefined, width = 720) {
  if (!links?.gif) return "";
  const video = links.mp4 ? `\n\n[Watch as video](${links.mp4})` : "";
  return `\n\n<img src="${links.gif}" width="${width}" alt="Kane's run in the browser">${video}`;
}

type ReportInput = {
  sha: string;
  results: ScenarioResult[];
  skipped: string[];
  clips: Map<string, ClipLinks>;
  runUrl?: string;
  fixEnabled: boolean;
};

export function buildReport({ sha, results, skipped, clips, runUrl, fixEnabled }: ReportInput) {
  const failed = results.filter((r) => r.outcome === "failed" || r.outcome === "error");
  const unsure = results.filter((r) => r.outcome === "unsure");
  const passed = results.filter((r) => r.outcome === "passed");
  const credits = results.reduce((sum, r) => sum + (r.end?.credits_consumed ?? 0), 0);

  const headline =
    results.length === 0
      ? "This PR doesn't touch the files of any scenario, so there was nothing to run."
      : failed.length > 0
        ? `**${failed.length} of ${results.length}** scenarios broke on this PR.`
        : `All ${results.length} affected scenarios pass in a real browser.`;

  const sections: string[] = [`${MARKER}\n### Proofed\n\n${headline}`];

  for (const r of failed) {
    const reason = r.end?.reason ?? r.error ?? "Kane did not finish the run.";
    const diagnosis = r.end?.verdict?.root_cause ?? r.end?.summary ?? "";
    sections.push(
      `#### ✗ ${r.scenario.name}\n\n${quote(reason)}${clip(clips.get(r.scenario.id))}` +
        (diagnosis && diagnosis !== reason ? `\n\n**What Kane saw:** ${diagnosis}` : "") +
        (r.end?.test_url ? `\n\n[Kane's step-by-step report](${r.end.test_url})` : ""),
    );
  }

  if (failed.length > 0 && fixEnabled) {
    sections.push(
      `- [ ] **${FIX_BOX}** — Claude Code gets the failure, the steps and the diff, pushes a fix to this branch, and Proofed checks again.`,
    );
  }

  for (const r of unsure) {
    sections.push(
      `#### ⚠ ${r.scenario.name}: the test may be wrong, not the code\n\n${quote(r.end?.reason)}` +
        (r.end?.verdict?.suggestion ? `\n\n**Kane suggests:** ${r.end.verdict.suggestion}` : "") +
        clip(clips.get(r.scenario.id), 560),
    );
  }

  if (passed.length > 0) {
    const items = passed.map((r) => `**✓ ${r.scenario.name}**${clip(clips.get(r.scenario.id), 560)}`).join("\n\n");
    sections.push(`<details><summary>✓ Passed: ${passed.map((r) => r.scenario.name).join(", ")}</summary>\n\n${items}\n\n</details>`);
  }

  if (skipped.length > 0) sections.push(`<sub>Not affected by this diff: ${skipped.join(", ")}</sub>`);

  const data: ReportData = {
    sha,
    failures: failed.map((r) => ({
      id: r.scenario.id,
      name: r.scenario.name,
      file: r.scenario.file,
      objective: r.scenario.objective,
      reason: r.end?.reason ?? r.error ?? "",
      diagnosis: r.end?.verdict?.root_cause ?? r.end?.summary ?? "",
    })),
  };

  const footer = [`Run by Kane CLI on ${sha.slice(0, 7)}`, credits > 0 && `${Math.round(credits)} credits`, runUrl && `[logs](${runUrl})`]
    .filter(Boolean)
    .join(" · ");
  // JSON inside an HTML comment: "--" would end the comment early, so escape it.
  const hidden = `<!-- proofed:data ${JSON.stringify(data).replaceAll("--", "\\u002d\\u002d")} -->`;

  return `${sections.join("\n\n")}\n\n<sub>${footer}</sub>\n${hidden}`;
}
