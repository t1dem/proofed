import type { Flags } from "./args.ts";
import type { Io } from "./check.ts";
import { readConfig, readWorkflow, resolveScenarioTarget, type TargetFields } from "../targets/target.ts";

export function targetFilter(flags: Pick<Flags, "target">, { env, cwd }: Pick<Io, "env" | "cwd">) {
  const requested = flags.target ?? env.PROOFED_TARGET?.trim();
  if (!requested) return () => true;
  // Validate the selector independently of execution settings for the selected scenarios.
  const { kind } = resolveScenarioTarget({}, { target: requested, execution: "local" }, env, cwd);
  const fallback = readConfig(cwd).target ?? readWorkflow(cwd)?.inputs.target ?? "web";
  return (scenario: TargetFields) => (scenario.target ?? fallback) === kind;
}
