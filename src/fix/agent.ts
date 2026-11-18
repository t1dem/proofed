import { askClaude } from "./claude.ts";
import { askCodex } from "./codex.ts";
import { DEFAULT_FIXER, providerOf, resolveFixer } from "./models.ts";
import { maskSecrets } from "../secrets.ts";

export function configuredFixer() {
  const fixer = resolveFixer({
    provider: process.env.PROOFED_PROVIDER,
    model: process.env.PROOFED_MODEL || process.env.PROOFED_CLAUDE_MODEL,
    effort: process.env.PROOFED_EFFORT || process.env.PROOFED_CLAUDE_EFFORT,
  }, DEFAULT_FIXER);
  if ("error" in fixer) throw new Error(fixer.error);
  return fixer;
}

// The answer goes into the PR, the commit message and the dashboard.
export function askAgent(prompt: string, options: Parameters<typeof askClaude>[1]) {
  const answer = providerOf(options.model) === "codex" ? askCodex(prompt, options) : askClaude(prompt, options);
  return answer.ok ? { ...answer, text: maskSecrets(answer.text) } : { ...answer, message: maskSecrets(answer.message) };
}
