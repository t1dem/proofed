import { isDeepStrictEqual } from "node:util";
import { baseRev, changedFiles } from "../changes.ts";
import { scenarioTarget } from "../fix/fixtarget.ts";
import { pickScenarios, type Scenario } from "../scenarios.ts";
import { askedScenario, askedScenarioFromFile, avoidFileId, descriptionRequest } from "./requests.ts";
import { APP_LOGIN, SETUP_BRANCH } from "./setup.ts";
import type { PullRequest } from "../github.ts";

function commonTarget(scenarios: Scenario[]) {
  const [first, ...rest] = scenarios;
  if (!first) return;
  const settings = (scenario: Scenario) => {
    const { sources, ...target } = scenarioTarget(scenario);
    return target;
  };
  const target = settings(first);
  if (rest.every((scenario) => isDeepStrictEqual(settings(scenario), target))) return first;
}

// Shared by the check and its Actions build/serve step, so only a selected web scenario needs HTTP.
export function checkSelection(pr: PullRequest | undefined, command: string | undefined, sha: string) {
  const globalTarget = process.env.PROOFED_TARGET?.trim();
  const pickFiles = () => {
    const only = process.env.PROOFED_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
    const rev = process.env.PROOFED_BASE_SHA || (pr && baseRev(pr.base));
    const changed = rev ? changedFiles(rev, sha === "local" ? "HEAD" : sha) : undefined;
    return pickScenarios({ changed, only, rev });
  };
  if (command) {
    let source: Scenario | undefined;
    if (!globalTarget) {
      try { source = commonTarget(pickFiles().selected); }
      catch { /* A text-only command can still run when file scenarios are unavailable. */ }
    }
    const asked = [source ? askedScenarioFromFile("comment", command, source) : askedScenario("comment", command)];
    return { selected: asked, skipped: [] as string[], asked };
  }
  const picked = pickFiles();
  const ownPr = pr?.head.ref === SETUP_BRANCH || pr?.user?.login === APP_LOGIN;
  const request = ownPr ? undefined : descriptionRequest(pr?.body);
  const asked: Scenario[] = [];
  if (request) {
    const source = globalTarget ? undefined : commonTarget(picked.selected);
    if (source) asked.push(askedScenarioFromFile("description", request, source));
    else if (globalTarget || (!picked.selected.length && process.env.PROOFED_URL?.trim())) asked.push(askedScenario("description", request));
  }
  const distinct = asked.map((s) => avoidFileId(s, picked.selected));
  return { selected: [...picked.selected, ...distinct], skipped: picked.skipped, asked: distinct };
}
