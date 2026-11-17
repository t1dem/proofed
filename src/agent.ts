import { askClaude } from "./claude.ts";
import { askCodex } from "./codex.ts";
import { DEFAULT_FIXER, isProvider, providerOf, resolveFixer } from "./models.ts";

export function configuredFixer() {
  const provider = process.env.PROOFED_PROVIDER;
  const fixer = resolveFixer({
    model: process.env.PROOFED_MODEL || process.env.PROOFED_CLAUDE_MODEL,
    effort: process.env.PROOFED_EFFORT || process.env.PROOFED_CLAUDE_EFFORT,
    ...(provider && isProvider(provider) ? { provider } : {}),
  }, DEFAULT_FIXER);
  if ("error" in fixer) throw new Error(fixer.error);
  return fixer;
}

export function askAgent(prompt: string, options: Parameters<typeof askClaude>[1]) {
  return providerOf(options.model) === "codex" ? askCodex(prompt, options) : askClaude(prompt, options);
}
