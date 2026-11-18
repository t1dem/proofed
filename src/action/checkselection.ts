import { baseRev, changedFiles } from "../changes.ts";
import { pickScenarios } from "../scenarios.ts";
import { askedScenario, descriptionRequest } from "./requests.ts";
import { APP_LOGIN, SETUP_BRANCH } from "./setup.ts";
import type { PullRequest } from "../github.ts";

// Shared by the check and its Actions build/serve step, so only a selected web scenario needs HTTP.
export function checkSelection(pr: PullRequest | undefined, command: string | undefined, sha: string, base?: string) {
  if (command) {
    const asked = [askedScenario("comment", command)];
    return { selected: asked, skipped: [] as string[], asked };
  }
  const ownPr = pr?.head.ref === SETUP_BRANCH || pr?.user?.login === APP_LOGIN;
  const request = ownPr ? undefined : descriptionRequest(pr?.body);
  const asked = request ? [askedScenario("description", request)] : [];
  const only = process.env.PROOFED_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
  const rev = base ?? (pr && baseRev(pr.base));
  const changed = rev ? changedFiles(rev, sha === "local" ? "HEAD" : sha) : undefined;
  const picked = pickScenarios({ changed, only, rev });
  return { selected: [...picked.selected, ...asked], skipped: picked.skipped, asked };
}
