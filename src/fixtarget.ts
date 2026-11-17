import { resolveScenarioTarget } from "./target.ts";
import type { Scenario } from "./scenarios.ts";

export const scenarioTarget = (s: Scenario) => s.resolvedTarget ?? resolveScenarioTarget(s, {}, process.env, process.cwd());

export function targetScenarios(scenarios: Scenario[]) {
  const filter = process.env.PROOFED_TARGET;
  return scenarios
    .filter((s) => !filter || (s.resolvedTarget ? s.resolvedTarget.kind === filter : !s.file || (s.target ?? "web") === filter))
    .map((s) => ({ ...s, resolvedTarget: scenarioTarget(s) }));
}

export function checkedAt(s: Scenario) {
  const target = scenarioTarget(s);
  if (target.kind === "web") return "in Chrome";
  if (target.kind === "desktop") return "in the desktop app";
  if (target.kind === "android") return target.execution === "local" ? "on an Android emulator" : "on an Android device";
  return target.execution === "local" ? "in an iOS simulator" : "on an iOS device";
}

export const checkedWhere = (scenarios: Scenario[]) => [...new Set(scenarios.map(checkedAt))].join(" and ");
export const needsWeb = (scenarios: Scenario[]) => scenarios.some((s) => scenarioTarget(s).kind === "web");

// Only the scenarios this fix must verify matter; an unrelated pre-uploaded app does not block it.
export function fixRefusal(scenarios: Scenario[], build: string | undefined) {
  for (const s of scenarios) {
    const target = scenarioTarget(s);
    if (target.kind === "web") continue;
    if ((target.kind === "android" || target.kind === "ios") && /^APP[\w-]+$/.test(target.app ?? ""))
      return `Fix didn't run: "${s.name}" uses a pre-uploaded TestMu APP ID. Set app to a build artifact path so Kane can check the rebuild.`;
    if (target.kind === "desktop" && !target.launch && !target.app)
      return `Fix didn't run: "${s.name}" has only a desktop CDP endpoint. Set launch or app so Proofed can restart the rebuilt app.`;
    if (!build?.trim())
      return `Fix didn't run: "${s.name}" needs a build command for its ${target.kind} target. Set PROOFED_BUILD (the action's build input) to rebuild the app before Kane checks it.`;
  }
}

// Both attempts and the final check use runAll directly, never the CLI pass cache.
export async function checkFix<T>(scenarios: Scenario[], serve: () => Promise<() => void | Promise<void>>, check: (scenarios: Scenario[]) => Promise<T>) {
  const stop = needsWeb(scenarios) ? await serve() : undefined;
  try { return await check(scenarios); }
  finally { await stop?.(); }
}
