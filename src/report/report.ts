import { checkedWhere } from "../fix/fixtarget.ts";
import { gitPath } from "../paths.ts";
import { MARKER, OLD_MARKER } from "../github.ts";
import { BLANK_PAGE, FAILED_CHECK_ACTION, FAILED_CHECK_REASON } from "./runfile.ts";
import type { Step } from "../kane/kane.ts";
import { DEFAULT_FIXER, describeFixer, providerLabel, providerOf, type Fixer, type Provider } from "../fix/models.ts";
import { DESCRIPTION_DOUBTED, DESCRIPTION_UNCHECKED, descriptionCheckNote, isDescriptionScenario } from "../action/requests.ts";
import { creditsOf, scenarioDoubted, unchecked } from "./runresult.ts";
import type { ScenarioResult } from "../types.ts";
import type { Scenario } from "../scenarios.ts";
import type { FixSetup } from "../fix/fixsetup.ts";
import {
  addRun, collectReportData, COMMENT_LIMIT, compactReportData, dataComment, kaneSteps, MAX_STEPS, oneLine, runMarker,
  type ClipLinks, type FailureData, type ReportData, type RunEntry, type RunState,
} from "./reportdata.ts";

export { addRun, alreadyReported, dataComment, outcomeOf, postsNew, readReportData, readRunKey, runMarker } from "./reportdata.ts";
export type { ClipLinks, FailureData, Outcome, ReportData, RunEntry, RunState } from "./reportdata.ts";

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

// The setup PR's first check (generate.ts): the scenarios the selected agent wrote that Kane saw pass and Proofed
// committed, each with the fixer's line on what it checks, and the ones it dropped. "failed": Claude
// didn't get as far as writing any, or the push failed. `credits`: what Kane spent on the scenarios that
// weren't kept, which the results don't carry but the run cost all the same.
export type Written = (
  | { status: "written"; kept: { id: string; about: string }[]; dropped: { name: string; why: string }[]; commit?: string; commitUrl?: string }
  | { status: "failed" }
) & { credits?: number; provider?: Provider };

// Claude keeps its old label: installed workflows filter edits by this exact text.
export const FIX_BOX = "Fix with Claude";

export const fixRequested = (body: string) => /^- \[x\] \*\*Fix with (?:Claude|Codex)\*\*/m.test(body);

export const WORKING = "⏳ **Claude is working on a fix**";

export const FIX_BOX_LINE = /^- \[[ x]\] \*\*Fix with (?:Claude|Codex)\*\*[^\n]*/m;
// The event and current comment may differ by the checkbox tick itself.
export const sameFixRequest = (current: string | undefined, requested: string) => {
  const untick = (body: string) => body.replace(FIX_BOX_LINE, (line) => line.replace("[x]", "[ ]"));
  return current !== undefined && untick(current) === untick(requested);
};
const LIVE_LINES = /\n\n(?:- \[[ x]\] \*\*Fix with (?:Claude|Codex)\*\*|⏳ \*\*(?:Claude|Codex) is working on a fix\*\*)[^\n]*/g;
const OMISSION_NOTE = "_Some report details were omitted to fit GitHub's comment limit._";
const OMITTED_REQUEST = "Proofed couldn't keep the failed ad hoc request in this report. Run the check again to retry it.";

// A report a newer one replaced: without the fix box, so nobody ticks a stale one, or a "working" line
// that would never end, and with a marker that nothing reads as the PR's report.
export const outdated = (body: string) => body.replaceAll(MARKER, OLD_MARKER).replace(LIVE_LINES, "");

const quote = (text = "") =>
  text
    .trim()
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");

const short = (sha: string) => sha.slice(0, 7);

// Inside <details> and tables GitHub would take "<Cart>" for a tag and drop it.
const html = (text: string) => text.replaceAll("<", "&lt;");
const cell = (text: string) => html(oneLine(text)).replaceAll("|", "\\|");
const code = (text: string) => `\`${oneLine(text).replaceAll("`", "'")}\``;
const commitRef = (sha: string, url?: string) => (url ? `[\`${short(sha)}\`](${url})` : `\`${short(sha)}\``);

function clip(links: ClipLinks | undefined, width = 720) {
  if (!links?.gif) return "";
  const video = links.mp4 ? `\n\n[Watch as video](${links.mp4})` : "";
  return `\n\n<img src="${links.gif}" width="${width}" alt="Kane's run">${video}`;
}

// Only a still and no recording: the screenshot of a page that crashed on load (precheck.ts).
const isScreenshot = (links: ClipLinks | undefined) => !!links?.jpg && !links.gif && !links.mp4;
const SCREENSHOT_ALT = "What a user sees on opening the page";

function screenshot(links: ClipLinks | undefined, url: string) {
  if (!isScreenshot(links)) return "";
  return `\n\n<img src="${links!.jpg}" width="720" alt="${SCREENSHOT_ALT}">\n\n<sub>This is what a user sees on opening ${code(url)}.</sub>`;
}

function still(links: ClipLinks | undefined) {
  const src = links?.jpg ?? links?.gif;
  if (!src) return "";
  const img = `<img src="${src}" width="360" alt="${isScreenshot(links) ? SCREENSHOT_ALT : "Kane's run"}">`;
  return links?.mp4 ? `<a href="${links.mp4}">${img}</a>` : img;
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

function gaveUpSummary(fix: FixNote) {
  return `**Tried ${fix.attempts} times with ${describeFixer(fix)} and couldn't make it pass.** Nothing was pushed.`;
}

// Add the attempted fix to the original report without recomputing its check results.
export function withGaveUpAttempt(body: string, fix: FixNote, attemptNote: string) {
  const summary = gaveUpSummary(fix);
  const passed = attemptNote ? `\n\n${html(attemptNote)}` : "";
  const details = `${summary} Last attempt: ${html(oneLine(fix.summary))}${passed}${attemptList(fix)}`;
  const place = (text: string) => FIX_BOX_LINE.test(body)
    ? body.replace(FIX_BOX_LINE, () => text)
    : body.replace(/(### Proofed\n\n[^\n]*)/, (_, headline: string) => `${headline}\n\n${text}`);
  const shortNote = "**The fix failed.** Nothing was pushed.";
  for (const note of [details, summary + passed, summary, shortNote]) {
    const edited = place(note);
    if (edited.length <= COMMENT_LIMIT) return edited;
  }
  return body.replace(OMISSION_NOTE, shortNote).replace(/^- \[x\] (\*\*Fix with (?:Claude|Codex)\*\*)/m, "- [ ] $1");
}

function whatChanged(fix: FixNote) {
  const files = fix.changes ?? [];
  const listed = files.slice(0, 5).map((f) => `\`${f.file}\` (+${f.added} −${f.removed})`).join(", ");
  const more = files.length > 5 ? ` and ${files.length - 5} more` : "";
  const text = [listed && `${listed}${more}.`, fix.summary].filter(Boolean).join(" ");
  return text ? `\n\n**What changed:** ${text}` : "";
}

function writtenSection(written: Written, results: ScenarioResult[], clips: Map<string, ClipLinks>) {
  const provider = providerLabel(written.provider ?? "claude");
  if (written.status === "failed") return "Proofed tried to add scenarios for this app's main flows, but the scenarios couldn't be written this time.";
  const kept = written.kept.flatMap(({ id, about }) => results.filter((r) => r.scenario.id === id).map((r) => ({ r, about })));
  const dropped = written.dropped.map((d) => `- **${html(d.name)}**: ${html(oneLine(d.why, 200))}`).join("\n");
  if (kept.length === 0) {
    return dropped
      ? `${provider} wrote ${written.dropped.length === 1 ? "a scenario" : `${written.dropped.length} scenarios`} for this app, but Kane didn't see ${written.dropped.length === 1 ? "it" : "any of them"} pass, so none were added:\n\n${dropped}`
      : `${provider} didn't find a flow it could write a scenario for without guessing, so none were added.`;
  }
  const folder = gitPath(kept[0]!.r.scenario.file).split("/").slice(0, -1).join("/");
  const commit = written.commit ? ` in ${commitRef(written.commit, written.commitUrl)}` : "";
  const intro =
    `**${provider} wrote ${kept.length === 1 ? "a scenario" : `${kept.length} scenarios`} for this app**, and Proofed added ${kept.length === 1 ? "it" : "them"} to this PR${commit}. ` +
    `Kane ran each one and saw it pass. They are plain Markdown in \`${folder}/\`: edit or delete them like any other file.`;
  const items = kept.map(
    ({ r, about }) => `**✓ ${r.scenario.name}** · \`${gitPath(r.scenario.file).split("/").at(-1)}\`<br>${html(oneLine(about, 200))}${clip(clips.get(r.scenario.id), 560)}`,
  );
  const droppedNote = dropped ? `\n\nDropped, since Kane didn't see ${written.dropped.length === 1 ? "it" : "them"} pass:\n\n${dropped}` : "";
  return `${intro}\n\n${items.join("\n\n")}${droppedNote}`;
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

const MARKS: Record<RunState, string> = { failed: "✗", passed: "✓", fixed: "✓ fixed", error: "⚠", unsure: "? not confirmed" };

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
  fixer?: Fixer;
  fix?: FixNote;
  asked?: Scenario[];
  // The data of the report this one replaces: run history, and after a fix, what was broken.
  previous?: ReportData;
  repoUrl?: string;
  // The folder on proofed-clips that holds this report's clips and run file, for the dashboard.
  runKey?: string;
  written?: Written;
  // Set when the workflow can't act on the fix box: a note goes where the box would be.
  fixSetup?: FixSetup;
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
  { sha, results: all, skipped, clips, runUrl, fixEnabled, fixer = DEFAULT_FIXER, fix, asked, previous, repoUrl, runKey, written, fixSetup }: ReportInput,
  { stepList: withSteps, storedSteps }: Fit,
) {
  const previousNote = previous?.descriptionNote;
  const carryNote = fix && !all.some((r) => isDescriptionScenario(r.scenario));
  const descriptionNote = all.map(descriptionCheckNote).find((note) => note)
    ?? (carryNote && (previousNote === DESCRIPTION_DOUBTED || previousNote === DESCRIPTION_UNCHECKED) ? previousNote : undefined)
    ?? (carryNote && previous?.failures.some((f) => isDescriptionScenario(f) && f.failedCheck === "scenario_doubted") ? DESCRIPTION_DOUBTED : undefined);
  const results = all.filter((r) => !descriptionCheckNote(r));
  const failed = results.filter((r) => r.outcome === "failed");
  const errored = results.filter((r) => r.outcome === "error");
  const unsure = results.filter((r) => r.outcome === "unsure");
  const passed = results.filter((r) => r.outcome === "passed");
  const credits = all.reduce((sum, r) => sum + creditsOf(r), written?.credits ?? 0);
  const repaired: Repaired[] =
    fix?.status === "fixed" && previous
      ? passed.flatMap((after) => {
          const before = previous.failures.find((f) => f.id === after.scenario.id);
          return before ? [{ before, after }] : [];
        })
      : [];
  const isRepaired = (r: ScenarioResult) => repaired.some((x) => x.after === r);
  const isWritten = (r: ScenarioResult) => written?.status === "written" && written.kept.some((k) => k.id === r.scenario.id);

  const where = checkedWhere(results.map((r) => r.scenario));
  const headline =
    results.length === 0
      ? "This PR doesn't touch the files of any scenario, so there was nothing to run."
      : failed.length > 0
        ? `**${failed.length} of ${results.length}** scenarios broke on this PR.`
        : errored.length > 0
          ? `Kane couldn't finish ${errored.length} of ${results.length} scenarios. Nothing points at the code yet.`
          : unsure.length > 0
            ? passed.length > 0
              ? `**${passed.length} of ${results.length}** scenarios pass ${where}; ${unsure.length} ${unsure.length === 1 ? "wasn't" : "weren't"} checked.`
              : results.length === 1
                ? "The affected scenario wasn't checked."
                : `None of the ${results.length} affected scenarios were checked.`
            : results.length === 1
              ? `The affected scenario passes ${where}.`
              : `All ${results.length} affected scenarios pass ${where}.`;

  const sections: string[] = [`${MARKER}\n### Proofed\n\n${headline}`];
  const recordingNote = all.find((r) => r.scenario.resolvedTarget?.execution === "cloud" && r.recordingNote)?.recordingNote;
  if (recordingNote) {
    sections.push(`<sub>${html(oneLine(recordingNote.replace(" is at kaneReport.", " is available in TestMu.")))}</sub>`);
  }
  const summary = [...sections];

  if (results.length >= 4) {
    const tag = (r: ScenarioResult) =>
      r.outcome === "error"
        ? ": couldn't finish"
        : unchecked(r)
          ? ": not checked"
          : r.outcome === "unsure"
            ? ": not checked"
            : isRepaired(r)
              ? ": fixed"
              : "";
    const mark = (r: ScenarioResult) => (r.outcome === "failed" ? "✗" : r.outcome === "passed" ? "✓" : "⚠");
    const list = [...failed, ...errored, ...unsure, ...passed].map((r) => `- ${mark(r)} ${r.scenario.name}${tag(r)}`).join("\n");
    sections.push(list);
    summary.push(list);
  }

  if (written) sections.push(writtenSection(written, passed, clips));

  if (fix?.status === "fixed") {
    const commit = fix.commit ? ` in ${commitRef(fix.commit, fix.commitUrl)}` : "";
    sections.push(
      `**Fixed${commit}** by ${describeFixer(fix)}, after ${fix.attempts} attempt${fix.attempts > 1 ? "s" : ""}.${whatChanged(fix)}${attemptList(fix)}`,
    );
  } else if (fix?.status === "gave-up") {
    sections.push(
      `${gaveUpSummary(fix)} Last attempt: ${fix.summary}` +
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
      : scenarioDoubted(r)
        ? `\n\n${FAILED_CHECK_REASON}\n\n**Kane's opinion:** ${diagnosis}\n\n${FAILED_CHECK_ACTION}`
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

  const provider = providerLabel(providerOf(fixer.model));
  if (failed.length > 0 && fixEnabled && fix?.status !== "gave-up") {
    sections.push(
      fixSetup
        ? `> ${fixSetup.note}`
        : `- [ ] **Fix with ${provider}**: ${provider} gets the failure, the steps and the diff, Kane checks the rebuild, and only a verified fix is pushed to this branch.`,
    );
  }

  for (const r of errored) {
    sections.push(
      `#### ⚠ ${r.scenario.name}: Kane couldn't finish\n\n${quote(r.error)}` +
        clip(clips.get(r.scenario.id), 560) +
        `\n\nThis is about the test run, not your code. Re-run the check to try again.`,
    );
  }

  for (const r of unsure) {
    sections.push(
      (unchecked(r)
        ? `#### ⚠ ${r.scenario.name}: not checked\n\n${quote(r.end?.reason)}\n\nKane called it a pass, but none of its steps checked the page, so this says nothing about the code either way.`
        : `#### ⚠ ${r.scenario.name}: not checked\n\n${quote(r.end?.reason ?? r.error)}` +
          (r.end?.verdict?.suggestion ? `\n\n**Kane suggests:** ${r.end.verdict.suggestion}` : "")) +
        clip(clips.get(r.scenario.id), 560),
    );
  }

  const others = passed.filter((r) => !isRepaired(r) && !isWritten(r));
  if (others.length > 0) {
    const items = others.map((r) => `**✓ ${r.scenario.name}**${clip(clips.get(r.scenario.id), 560)}`).join("\n\n");
    sections.push(`<details><summary>✓ Passed: ${others.map((r) => r.scenario.name).join(", ")}</summary>\n\n${items}\n\n</details>`);
  }

  if (skipped.length > 0) sections.push(`<sub>Not affected by this diff: ${skipped.join(", ")}</sub>`);
  if (descriptionNote) sections.push(`<sub>${descriptionNote}</sub>`);

  const state: RunState = failed.length > 0 ? "failed" : errored.length > 0 ? "error" : fix?.status === "fixed" ? "fixed" : unsure.length > 0 ? "unsure" : "passed";
  const history = addRun(previous?.history, { sha, state });
  const open = [...failed, ...errored, ...unsure].map((r) => r.scenario.id);
  const data = collectReportData({ sha, failed, open, asked, descriptionNote, clips, storedSteps, history });

  const footer = [`Run by Kane CLI on ${short(sha)}`, credits > 0 && `${Math.round(credits)} credits (Kane estimate)`, runUrl && `[logs](${runUrl})`]
    .filter(Boolean)
    .join(" · ");
  const canFix = failed.length > 0 && fixEnabled && (!fixSetup || fixSetup.comment);
  const hint = canFix
    ? `Comment <code>/proofed</code> to check again or <code>/proofed fix</code> to have ${provider} fix it.`
    : "Comment <code>/proofed</code> to check again.";
  const lines = [footer, history.length > 1 && historyLine(history, repoUrl), hint].filter(Boolean).join("<br>");
  const marker = runKey ? `\n${runMarker(runKey)}` : "";
  const body = `${sections.join("\n\n")}\n\n<sub>${lines}</sub>\n${dataComment(data)}${marker}`;
  if (storedSteps > 0 || body.length <= COMMENT_LIMIT) return body;

  for (const compact of compactReportData(data)) {
    const hasRequest = (id: string) => compact.asked?.some((s) => s.id === id);
    const notes = [OMISSION_NOTE];
    if (data.failures.some((f) => !f.file && !hasRequest(f.id))) notes.push(OMITTED_REQUEST);
    if (canFix && compact.failures.some((f) => f.file || hasRequest(f.id))) {
      notes.push("Comment `/proofed fix` to fix the scenarios kept in this report.");
    }
    const tail = `\n\n${notes.join("\n\n")}\n${dataComment(compact)}${marker}`;
    const remaining = COMMENT_LIMIT - tail.length;
    if (remaining >= summary[0]!.length) {
      const visible = summary.join("\n\n");
      const cut = visible.length <= remaining ? visible.length : visible.lastIndexOf("\n", remaining);
      return visible.slice(0, Math.max(cut, summary[0]!.length)).trimEnd() + tail;
    }
  }
  return [summary[0], OMISSION_NOTE, ...(data.failures.some((f) => !f.file) ? [OMITTED_REQUEST] : [])].join("\n\n");
}
