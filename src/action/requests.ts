import { baseRev } from "../changes.ts";
import { env } from "../env.ts";
import { effortsFor, isEffort, parseModel, type Effort } from "../fix/models.ts";
import { scenarioDoubted } from "../report/runresult.ts";
import type { ScenarioResult } from "../types.ts";
import { loadScenariosOr, type Scenario } from "../scenarios.ts";
import { checkedAt, scenarioTarget } from "../fix/fixtarget.ts";
import { resolveScenarioTarget, TARGET_KEYS, type Target } from "../targets/target.ts";

// "/proofed" in a PR comment re-runs the check, which also gives a PR opened before Proofed was
// added its first run. "/proofed <what to check>" has Kane check just that. A slash command,
// not "@proofed": that name belongs to someone else on GitHub and would mention them.
const COMMAND = /(?:^|\s)\/proofed\b([\s\S]*)/i;

export function parseCommand(comment: string): string | undefined {
  const match = COMMAND.exec(comment);
  return match ? match[1]!.trim() : undefined;
}

export type FixCommand = { model?: string; effort?: Effort } | { error: string };

// "/proofed fix [model] [effort]" has the fixer fix the broken scenarios, with that model this once.
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
  if ("error" in choice) return choice;
  if (effort && !effortsFor(choice.model).includes(effort)) return { error: `The model \`${choice.model}\` doesn't support \`${effort}\` effort.` };
  return { model: choice.model, effort };
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

const descriptionId = /^asked-in-description(?:-\d+)?$/;
export const isDescriptionScenario = (s: Pick<Scenario, "id" | "file">) => !s.file && descriptionId.test(s.id);
export const DESCRIPTION_DOUBTED = "Kane couldn't verify what the PR description asks.";
export const DESCRIPTION_UNCHECKED = "The PR description didn't name anything Kane could check.";

// The description is best effort. An unconfirmed result only gets a line under the report.
export function descriptionCheckNote(r: ScenarioResult) {
  if (!isDescriptionScenario(r.scenario) || r.requestUnavailable) return;
  if (scenarioDoubted(r)) return DESCRIPTION_DOUBTED;
  if (r.outcome === "unsure") return DESCRIPTION_UNCHECKED;
}

const NAMES = {
  description: "What the PR description asks",
  comment: "What the /proofed comment asks",
  terminal: "What you asked to check",
};

// "terminal": `proofed check "<text>"`, run by a person or a coding agent on their own machine.
export function askedScenario(where: keyof typeof NAMES, text: string, target: Target = resolveScenarioTarget({}, {}, process.env, process.cwd())): Scenario {
  const scenario: Scenario = {
    id: where === "terminal" ? "asked" : `asked-in-${where}`,
    file: "",
    name: NAMES[where],
    paths: [],
    url: "/",
    objective: "",
  };
  const location = target.kind === "web" ? "in the browser" : checkedAt({ ...scenario, resolvedTarget: target });
  scenario.objective =
    (where === "terminal"
      ? `The developer of this app asked for this to be checked:\n\n${text}\n\n`
      : `The author of this pull request asked for this to be checked:\n\n${text}\n\n`) +
    `Open the app and check exactly that ${location}, the way a user would. It passes only if what they ` +
    `asked about actually works; the ${target.kind === "web" ? "page" : "app"} loading is not enough.` +
    (where === "description" ? ` ${MAY_ASK_NOTHING}` : "");
  return scenario;
}

type AskedScenario = Scenario & { targetScenarioId?: string };

// File scenarios and requests share the output directory, which may be case-insensitive.
export function avoidFileId<T extends Pick<Scenario, "id" | "file">>(request: T, files: Scenario[]): T {
  if (request.file) return request;
  const fileIds = new Set(files.map((s) => s.id.toLowerCase()));
  if (!fileIds.has(request.id)) return request;
  const stem = request.id.replace(/-\d+$/, "");
  let suffix = 2;
  while (fileIds.has(`${stem}-${suffix}`)) suffix++;
  return { ...request, id: `${stem}-${suffix}` };
}

export function askedScenarioFromFile(where: "description" | "comment", text: string, source: Scenario): AskedScenario {
  const scenario: AskedScenario = { ...askedScenario(where, text, scenarioTarget(source)), targetScenarioId: source.id };
  for (const key of TARGET_KEYS) if (source[key]) scenario[key] = source[key];
  return scenario;
}

// Reports store the generated objective. Recover the original request only if the check's
// generator can reproduce that objective with the current target settings.
export function replayAskedScenario(stored: AskedScenario): Scenario | undefined {
  const where = descriptionId.test(stored.id) ? "description" : /^asked-in-comment(?:-\d+)?$/.test(stored.id) ? "comment" : undefined;
  if (!where || stored.file !== "" || stored.url !== "/" || typeof stored.objective !== "string") return;
  let template: Scenario;
  if (stored.targetScenarioId !== undefined) {
    const { PROOFED_BASE_REF: ref, PROOFED_BASE_SHA: sha } = process.env;
    const rev = ref && sha ? baseRev({ ref, sha }) : sha;
    // Read target settings from the checkout before replaying a request from a report.
    const source = loadScenariosOr(env("PROOFED_SCENARIOS", ".proofed/scenarios"), rev).find((s) => s.id === stored.targetScenarioId);
    if (!source) return;
    template = askedScenarioFromFile(where, "", source);
  } else template = askedScenario(where, "");
  const boundary = template.objective.indexOf("\n\n") + 2;
  const prefix = template.objective.slice(0, boundary);
  const suffix = template.objective.slice(boundary);
  if (!stored.objective.startsWith(prefix) || !stored.objective.endsWith(suffix)) return;
  const request = stored.objective.slice(prefix.length, -suffix.length);
  if (request.trim()) return { ...template, id: stored.id, objective: `${prefix}${request}${suffix}` };
}
