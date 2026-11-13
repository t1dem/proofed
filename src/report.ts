import { MARKER } from "./github.ts";
import { runMarker } from "./runfile.ts";
import type { Step } from "./kane.ts";
import { describeFixer, type Fixer } from "./models.ts";
import { BLANK_PAGE } from "./precheck.ts";
import { nothingAsked } from "./requests.ts";
import { unchecked, type ScenarioResult } from "./run.ts";
import type { Scenario } from "./scenarios.ts";

export type ClipLinks = { gif?: string; mp4?: string; jpg?: string };

// What the fix workflow needs to know about a failure, kept in the comment itself
// so the fix run doesn't depend on artifacts from another workflow.
// `clip` is the "before" side of the report after a fix; reports written before it existed have none.
export type FailureData = {
  id: string;
  name: string;
  file: string;
  objective: string;
  reason: string;
  diagnosis: string;
  steps: string[];
  clip?: ClipLinks;
};
export type RunState = "failed" | "passed" | "fixed" | "error";
export type RunEntry = { sha: string; state: RunState };
// `asked`: one-off checks from the PR description or a /proofed comment, kept so the fixer can re-run them.
// `history`: one entry per published report, newest last.
export type ReportData = { sha: string; failures: FailureData[]; asked?: Scenario[]; history?: RunEntry[] };
export type FileChange = { file: string; added: number; removed: number };
// One round of the fix loop: what Claude said it changed, and what came of it.
export type FixAttempt = { summary: string; result: string };
export type FixNote = Fixer & {
  status: "fixed" | "gave-up";
  attempts: number;
  summary: string;
  commit?: string;
  commitUrl?: string;
  tries?: FixAttempt[];
  changes?: FileChange[];
};

const DATA_RE = /<!-- proofed:data (.*?) -->/s;
export const FIX_BOX = "Fix with Claude";
const COMMENT_LIMIT = 65_536;
const HISTORY_SIZE = 8;
const MAX_STEPS = 30;
const MAX_STEP = 200;

export function readReportData(body: string): ReportData | undefined {
  const raw = DATA_RE.exec(body)?.[1];
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as ReportData;
  } catch {
    return undefined;
  }
}

// A push of the very commit the report is about: the Proofed app pushing Claude's fix, which the fix
// run checked and reported before it ended. Any other push brings a new commit, and a /proofed
// comment always runs, whatever the commit.
export const alreadyReported = (action: string | undefined, headSha: string, report: ReportData | undefined) =>
  action === "synchronize" && report?.sha === headSha;

export const fixRequested = (body: string) => body.includes(`- [x] **${FIX_BOX}**`);

// A re-run on the same commit replaces its entry. Re-checking a commit Claude pushed keeps it a fix.
export function addRun(history: RunEntry[] = [], run: RunEntry): RunEntry[] {
  const last = history.at(-1);
  if (last?.sha !== run.sha) return [...history, run].slice(-HISTORY_SIZE);
  const state = last.state === "fixed" && run.state === "passed" ? "fixed" : run.state;
  return [...history.slice(0, -1), { sha: run.sha, state }].slice(-HISTORY_SIZE);
}

const quote = (text = "") =>
  text
    .trim()
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");

const short = (sha: string) => sha.slice(0, 7);

// Kane's and Claude's words on one line, cut to `max` characters.
const oneLine = (text = "", max = 300) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};
// Inside <details> and tables GitHub would take "<Cart>" for a tag and drop it.
const html = (text: string) => text.replaceAll("<", "&lt;");
const cell = (text: string) => html(oneLine(text)).replaceAll("|", "\\|");
const code = (text: string) => `\`${oneLine(text).replaceAll("`", "'")}\``;
const commitRef = (sha: string, url?: string) => (url ? `[\`${short(sha)}\`](${url})` : `\`${short(sha)}\``);

function clip(links: ClipLinks | undefined, width = 720) {
  if (!links?.gif) return "";
  const video = links.mp4 ? `\n\n[Watch as video](${links.mp4})` : "";
  return `\n\n<img src="${links.gif}" width="${width}" alt="Kane's run in the browser">${video}`;
}

// Only a still and no recording: the screenshot of a page that crashed on load (precheck.ts).
const isScreenshot = (links: ClipLinks | undefined) => !!links?.jpg && !links.gif && !links.mp4;
const SCREENSHOT_ALT = "What a user sees on opening the page";

function screenshot(links: ClipLinks | undefined, url: string) {
  if (!isScreenshot(links)) return "";
  return `\n\n<img src="${links!.jpg}" width="720" alt="${SCREENSHOT_ALT}">\n\n<sub>This is what a user sees on opening ${code(url)}.</sub>`;
}

// The before/after table needs the video and a picture; the GIF only stands in for a missing still.
function storedClip(links: ClipLinks | undefined): ClipLinks | undefined {
  if (!links?.mp4 && !links?.jpg && !links?.gif) return undefined;
  return links.jpg ? { mp4: links.mp4, jpg: links.jpg } : { mp4: links.mp4, gif: links.gif };
}

function still(links: ClipLinks | undefined) {
  const src = links?.jpg ?? links?.gif;
  if (!src) return "";
  const img = `<img src="${src}" width="360" alt="${isScreenshot(links) ? SCREENSHOT_ALT : "Kane's run in the browser"}">`;
  return links?.mp4 ? `<a href="${links.mp4}">${img}</a>` : img;
}

// The last `keep` steps Kane finished, each cut to MAX_STEP characters.
function kaneSteps(steps: Step[], keep = MAX_STEPS) {
  const done = steps.filter((s) => s.status !== "running" && s.remark);
  const from = Math.max(done.length - keep, 0);
  return {
    from: from + 1,
    steps: done.slice(from).map((s) => ({ failed: s.status === "failed", text: oneLine(s.remark, MAX_STEP) })),
  };
}

function stepList(steps: Step[]) {
  const { from, steps: kept } = kaneSteps(steps);
  if (kept.length === 0) return "";
  const items = kept.map((s, i) => `${from + i}. ${s.failed ? `**✗ ${html(s.text)}**` : html(s.text)}`);
  return `\n\n<details><summary>Kane's steps</summary>\n\n${items.join("\n")}\n\n</details>`;
}

function attemptList(fix: FixNote) {
  const tries = fix.tries ?? [];
  if (tries.length < 2) return "";
  const items = tries.map((t, i) => `${i + 1}. ${html(oneLine([t.summary, t.result].filter(Boolean).join(" ")))}`);
  return `\n\n<details><summary>${tries.length} attempts</summary>\n\n${items.join("\n")}\n\n</details>`;
}

function whatChanged(fix: FixNote) {
  const files = fix.changes ?? [];
  const listed = files.slice(0, 5).map((f) => `\`${f.file}\` (+${f.added} −${f.removed})`).join(", ");
  const more = files.length > 5 ? ` and ${files.length - 5} more` : "";
  const text = [listed && `${listed}${more}.`, fix.summary].filter(Boolean).join(" ");
  return text ? `\n\n**What changed:** ${text}` : "";
}

type Repaired = { before: FailureData; after: ScenarioResult };

// The commit, the fixer and what changed are said once, above all the repaired scenarios.
// A page that crashed on load has its screenshot as the still and the browser's error under it
// (precheck.ts keeps the error as the diagnosis). Reports from before screenshots have only the error;
// with a still on one side only, it goes above that side's text instead of in a half-empty row.
function beforeAfter({ before, after }: Repaired, beforeSha: string, sha: string, links: ClipLinks | undefined) {
  const stills = [still(before.clip), still(links)];
  const confirmed = after.end?.summary?.trim() || after.end?.reason?.trim() || "Passes.";
  const consoleError = before.reason === BLANK_PAGE && before.diagnosis ? `<br><br>${code(before.diagnosis).replaceAll("|", "\\|")}` : "";
  const texts = [`✗ ${cell(before.reason || before.diagnosis || "Failed.")}${consoleError}`, `✓ ${cell(confirmed)}`];
  const both = stills.every(Boolean);
  const rows = [
    `| Before · \`${short(beforeSha)}\` | After · \`${short(sha)}\` |`,
    "|---|---|",
    ...(both ? [`| ${stills.join(" | ")} |`] : []),
    `| ${texts.map((t, i) => (!both && stills[i] ? `${stills[i]}<br>${t}` : t)).join(" | ")} |`,
  ];
  return `#### ✓ ${after.scenario.name}\n\n${rows.join("\n")}`;
}

const MARKS: Record<RunState, string> = { failed: "✗", passed: "✓", fixed: "✓ fixed", error: "⚠" };

function historyLine(history: RunEntry[], repoUrl: string | undefined) {
  return history
    .map((h) => `${repoUrl ? `[${short(h.sha)}](${repoUrl}/commit/${h.sha})` : short(h.sha)} ${MARKS[h.state]}`)
    .join(" → ");
}

type ReportInput = {
  sha: string;
  results: ScenarioResult[];
  skipped: string[];
  clips: Map<string, ClipLinks>;
  runUrl?: string;
  fixEnabled: boolean;
  fix?: FixNote;
  asked?: Scenario[];
  // The data of the report this one replaces: run history, and after a fix, what was broken.
  previous?: ReportData;
  repoUrl?: string;
  // The folder on proofed-clips that holds this report's clips and run file, for the dashboard.
  runKey?: string;
};

type Fit = { stepList: boolean; storedSteps: number };
// When the comment doesn't fit, Kane's step lists go first (the TestMu report has them too),
// then the steps kept for the fixer.
const FITS: Fit[] = [
  { stepList: true, storedSteps: MAX_STEPS },
  { stepList: false, storedSteps: MAX_STEPS },
  { stepList: false, storedSteps: 10 },
  { stepList: false, storedSteps: 0 },
];

export function buildReport(input: ReportInput) {
  let body = "";
  for (const fit of FITS) {
    body = compose(input, fit);
    if (body.length <= COMMENT_LIMIT) break;
  }
  return body;
}

function compose(
  { sha, results: all, skipped, clips, runUrl, fixEnabled, fix, asked, previous, repoUrl, runKey }: ReportInput,
  { stepList: withSteps, storedSteps }: Fit,
) {
  const unasked = all.filter(nothingAsked);
  const results = all.filter((r) => !nothingAsked(r));
  const failed = results.filter((r) => r.outcome === "failed");
  const errored = results.filter((r) => r.outcome === "error");
  const unsure = results.filter((r) => r.outcome === "unsure");
  const passed = results.filter((r) => r.outcome === "passed");
  const credits = all.reduce((sum, r) => sum + (r.end?.credits_consumed ?? 0), 0);
  const repaired: Repaired[] =
    fix?.status === "fixed" && previous
      ? passed.flatMap((after) => {
          const before = previous.failures.find((f) => f.id === after.scenario.id);
          return before ? [{ before, after }] : [];
        })
      : [];
  const isRepaired = (r: ScenarioResult) => repaired.some((x) => x.after === r);

  const headline =
    results.length === 0
      ? "This PR doesn't touch the files of any scenario, so there was nothing to run."
      : failed.length > 0
        ? `**${failed.length} of ${results.length}** scenarios broke on this PR.`
        : errored.length > 0
          ? `Kane couldn't finish ${errored.length} of ${results.length} scenarios. Nothing points at the code yet.`
          : unsure.length > 0
            ? passed.length > 0
              ? `**${passed.length} of ${results.length}** scenarios pass in a real browser; ${unsure.length} ${unsure.length === 1 ? "wasn't" : "weren't"} checked.`
              : results.length === 1
                ? "The affected scenario wasn't checked."
                : `None of the ${results.length} affected scenarios were checked.`
            : results.length === 1
              ? "The affected scenario passes in a real browser."
              : `All ${results.length} affected scenarios pass in a real browser.`;

  const sections: string[] = [`${MARKER}\n### Proofed\n\n${headline}`];

  if (results.length >= 4) {
    const tag = (r: ScenarioResult) =>
      r.outcome === "error"
        ? ": couldn't finish"
        : unchecked(r)
          ? ": not checked"
          : r.outcome === "unsure"
            ? ": the test may be wrong"
            : isRepaired(r)
              ? ": fixed"
              : "";
    const mark = (r: ScenarioResult) => (r.outcome === "failed" ? "✗" : r.outcome === "passed" ? "✓" : "⚠");
    sections.push([...failed, ...errored, ...unsure, ...passed].map((r) => `- ${mark(r)} ${r.scenario.name}${tag(r)}`).join("\n"));
  }

  if (fix?.status === "fixed") {
    const commit = fix.commit ? ` in ${commitRef(fix.commit, fix.commitUrl)}` : "";
    sections.push(
      `**Fixed${commit}** by ${describeFixer(fix)}, after ${fix.attempts} attempt${fix.attempts > 1 ? "s" : ""}.${whatChanged(fix)}${attemptList(fix)}`,
    );
  } else if (fix?.status === "gave-up") {
    sections.push(
      `**Tried ${fix.attempts} times with ${describeFixer(fix)} and couldn't make it pass.** Nothing was pushed. Last attempt: ${fix.summary}` +
        attemptList(fix),
    );
  }

  if (fix && previous) {
    for (const r of repaired) sections.push(beforeAfter(r, previous.sha, sha, clips.get(r.after.scenario.id)));
  }

  for (const r of failed) {
    const reason = r.end?.reason ?? "";
    const diagnosis = r.end?.verdict?.root_cause ?? r.end?.summary ?? "";
    // A page that crashed on load never reached Kane: the error is the browser's, not Kane's reading.
    const seen = r.pageError
      ? `\n\n**Browser console error:** ${code(r.pageError)}`
      : diagnosis && diagnosis !== reason
        ? `\n\n**What Kane saw:** ${diagnosis}`
        : "";
    sections.push(
      `#### ✗ ${r.scenario.name}\n\n${quote(reason)}${clip(clips.get(r.scenario.id)) || screenshot(clips.get(r.scenario.id), r.scenario.url)}` +
        seen +
        (withSteps ? stepList(r.steps) : "") +
        (r.end?.test_url ? `\n\n[Kane's step-by-step report](${r.end.test_url})` : ""),
    );
  }

  if (failed.length > 0 && fixEnabled && fix?.status !== "gave-up") {
    sections.push(
      `- [ ] **${FIX_BOX}** — Claude Code gets the failure, the steps and the diff, pushes a fix to this branch, and Proofed checks again.`,
    );
  }

  for (const r of errored) {
    sections.push(
      `#### ⚠ ${r.scenario.name}: Kane couldn't finish, even after a retry\n\n${quote(r.error)}` +
        clip(clips.get(r.scenario.id), 560) +
        `\n\nThis is about the test run, not your code. Re-run the check to try again.`,
    );
  }

  for (const r of unsure) {
    sections.push(
      (unchecked(r)
        ? `#### ⚠ ${r.scenario.name}: not checked\n\n${quote(r.end?.reason)}\n\nKane called it a pass, but none of its steps checked the page, so this says nothing about the code either way.`
        : `#### ⚠ ${r.scenario.name}: the test may be wrong, not the code\n\n${quote(r.end?.reason)}` +
          (r.end?.verdict?.suggestion ? `\n\n**Kane suggests:** ${r.end.verdict.suggestion}` : "")) +
        clip(clips.get(r.scenario.id), 560),
    );
  }

  const others = passed.filter((r) => !isRepaired(r));
  if (others.length > 0) {
    const items = others.map((r) => `**✓ ${r.scenario.name}**${clip(clips.get(r.scenario.id), 560)}`).join("\n\n");
    sections.push(`<details><summary>✓ Passed: ${others.map((r) => r.scenario.name).join(", ")}</summary>\n\n${items}\n\n</details>`);
  }

  if (skipped.length > 0) sections.push(`<sub>Not affected by this diff: ${skipped.join(", ")}</sub>`);
  if (unasked.length > 0) sections.push("<sub>The PR description didn't name anything Kane could check in the browser.</sub>");

  const state: RunState = failed.length > 0 ? "failed" : errored.length > 0 ? "error" : fix?.status === "fixed" ? "fixed" : "passed";
  const history = addRun(previous?.history, { sha, state });
  // Not kept for the fixer: its final check would only spend credits finding nothing to check again.
  const rerun = asked?.filter((s) => !unasked.some((r) => r.scenario.id === s.id));
  const data: ReportData = {
    sha,
    ...(rerun?.length && { asked: rerun }),
    failures: failed.map((r) => ({
      id: r.scenario.id,
      name: r.scenario.name,
      file: r.scenario.file,
      objective: r.scenario.objective,
      reason: r.end?.reason ?? "",
      diagnosis: r.end?.verdict?.root_cause ?? r.end?.summary ?? "",
      steps: kaneSteps(r.steps, storedSteps).steps.map((s) => `${s.failed ? "✗" : "·"} ${s.text}`),
      clip: storedClip(clips.get(r.scenario.id)),
    })),
    history,
  };

  const footer = [`Run by Kane CLI on ${short(sha)}`, credits > 0 && `${Math.round(credits)} credits`, runUrl && `[logs](${runUrl})`]
    .filter(Boolean)
    .join(" · ");
  const canFix = failed.length > 0 && fixEnabled;
  const hint = canFix
    ? "Comment <code>/proofed</code> to check again or <code>/proofed fix</code> to have Claude fix it."
    : "Comment <code>/proofed</code> to check again.";
  const lines = [footer, history.length > 1 && historyLine(history, repoUrl), hint].filter(Boolean).join("<br>");
  // JSON inside an HTML comment: "--" would end the comment early, so escape it.
  const hidden = `<!-- proofed:data ${JSON.stringify(data).replaceAll("--", "\\u002d\\u002d")} -->`;

  return `${sections.join("\n\n")}\n\n<sub>${lines}</sub>\n${hidden}${runKey ? `\n${runMarker(runKey)}` : ""}`;
}
