import { isEffort, parseModel, type Effort } from "./models.ts";
import type { ScenarioResult } from "./run.ts";
import type { Scenario } from "./scenarios.ts";

// "/proofed" in a PR comment re-runs the check, which also gives a PR opened before Proofed was
// added its first run. "/proofed <what to check>" has Kane check just that. A slash command,
// not "@proofed": that name belongs to someone else on GitHub and would mention them.
const COMMAND = /(?:^|\s)\/proofed\b([\s\S]*)/i;

export function parseCommand(comment: string): string | undefined {
  const match = COMMAND.exec(comment);
  return match ? match[1]!.trim() : undefined;
}

export type FixCommand = { model?: string; effort?: Effort } | { error: string };

// "/proofed fix [model] [effort]" has Claude fix the broken scenarios, with that model this once.
// Only the first line counts, so a note under the command doesn't become part of the model name.
export function parseFix(command: string): FixCommand | undefined {
  const words = (command.split("\n")[0] ?? "").trim().split(/\s+/).filter(Boolean);
  if (words[0]?.toLowerCase() !== "fix") return undefined;
  const rest = words.slice(1);
  const last = rest.at(-1)?.toLowerCase() ?? "";
  const effort = isEffort(last) ? last : undefined;
  const modelWords = effort ? rest.slice(0, -1) : rest;
  if (modelWords.length === 0) return { effort };
  const choice = parseModel(modelWords);
  return "error" in choice ? choice : { model: choice.model, effort };
}

// What the PR description asks to have checked. HTML comments (PR templates) are dropped, and a
// long description is a changelog rather than a request, so it's left alone.
export function descriptionRequest(body: string | null | undefined) {
  const text = (body ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();
  return text && text.length <= 1500 ? text : undefined;
}

// Any short description becomes a request, and many ask for nothing ("Will be closed, not merged.").
// Left to itself Kane then improvises: it signs in, ends up on GitHub's OAuth page, and the report
// says the test may be wrong. A /proofed comment is always a request, so it gets no such way out.
const MAY_ASK_NOTHING =
  "If the text above doesn't describe something a user can see or do in this app, stop right away " +
  "without clicking anything: there is nothing to check. Never sign in, and never leave the app's own pages to get there.";

// The description asked for nothing Kane could check: not a result of the PR, only a line under the report.
export const nothingAsked = (r: ScenarioResult) => r.scenario.id === "asked-in-description" && r.outcome === "unsure";

export function askedScenario(where: "description" | "comment", text: string): Scenario {
  return {
    id: `asked-in-${where}`,
    file: "",
    name: where === "description" ? "What the PR description asks" : "What the /proofed comment asks",
    paths: [],
    url: "/",
    objective:
      `The author of this pull request asked for this to be checked:\n\n${text}\n\n` +
      "Open the app and check exactly that in the browser, the way a user would. It passes only if what they " +
      "asked about actually works; the page loading is not enough." +
      (where === "description" ? ` ${MAY_ASK_NOTHING}` : ""),
  };
}
