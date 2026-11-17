// Shared with the dashboard; keep this file free of Node imports.
export const PROVIDERS = ["claude", "codex"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const EFFORTS = [...CLAUDE_EFFORTS, "ultra"] as const;
export type Effort = (typeof EFFORTS)[number];

// Codex IDs and efforts come from its authenticated model catalog (models_cache.json).
// Luna has no ultra; the CLI's ReasoningEffort enum also accepts max and ultra.
export const MODELS = [
  { provider: "claude", name: "haiku", id: "claude-haiku-5-5", efforts: CLAUDE_EFFORTS },
  { provider: "claude", name: "sonnet", id: "claude-sonnet-5-5", efforts: CLAUDE_EFFORTS },
  { provider: "claude", name: "opus", id: "claude-opus-5-5", efforts: CLAUDE_EFFORTS },
  { provider: "claude", name: "fable", id: "claude-fable-5-2", efforts: CLAUDE_EFFORTS },
  { provider: "codex", name: "sol", id: "gpt-6.1-sol", efforts: EFFORTS },
  { provider: "codex", name: "terra", id: "gpt-6.1-terra", efforts: EFFORTS },
  { provider: "codex", name: "astra", id: "gpt-6-astra", efforts: EFFORTS },
  { provider: "codex", name: "luna", id: "gpt-6-luna", efforts: CLAUDE_EFFORTS },
] as const;

// Old reports and workflows have no provider field; their model identifies it.
export type Fixer = { provider?: Provider; model: string; effort: string };
export const DEFAULT_FIXER: Fixer = { model: "claude-haiku-5-5", effort: "xhigh" };
export const providerOf = (model: string): Provider => model.startsWith("gpt-") ? "codex" : "claude";
export const providerLabel = (provider: Provider) => provider === "codex" ? "Codex" : "Claude";
export const isProvider = (word: string): word is Provider => PROVIDERS.some((p) => p === word);
export const isEffort = (word: string): word is Effort => EFFORTS.some((e) => e === word);
export const isModelId = (text: string) => /^claude-[a-z0-9][a-z0-9.-]{2,60}$/.test(text) || MODELS.some((m) => m.provider === "codex" && m.id === text);
export const effortsFor = (model: string): readonly Effort[] => MODELS.find((m) => m.id === model)?.efforts ?? CLAUDE_EFFORTS;
export const defaultModel = (provider: Provider) => MODELS.find((m) => m.provider === provider)!.id;

export function modelLabel(id: string) {
  if (providerOf(id) === "codex") return id.replace(/^gpt-/, "GPT-").replace(/-(sol|terra|astra|luna)$/, (_, name: string) => ` ${name[0]!.toUpperCase()}${name.slice(1)}`);
  const match = /^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?$/.exec(id);
  if (!match) return id;
  const [, family = "", major, minor] = match;
  return `${family[0]!.toUpperCase()}${family.slice(1)} ${major}.${minor}`;
}

export function describeFixer({ model, effort }: Fixer) {
  const label = modelLabel(model);
  return `${label === model ? `\`${model}\`` : `${providerLabel(providerOf(model))} ${label}`}, ${effort} effort`;
}

export type ModelChoice = { model: string } | { error: string };
export function parseModel(words: string[]): ModelChoice {
  const [first = "", version, ...rest] = words.map((w) => w.toLowerCase());
  const family = MODELS.find((m) => m.name === first);
  if (words.length === 1 && isProvider(first)) return { model: defaultModel(first) };
  if (family && version === undefined) return { model: family.id };
  if (family?.provider === "claude" && rest.length === 0 && version && /^\d+([.-]\d+)?$/.test(version)) {
    return { model: `claude-${family.name}-${version.replace(".", "-")}` };
  }
  if (words.length === 1 && isModelId(first)) return { model: first };
  return { error: `Proofed doesn't know the model \`${words.join(" ")}\`. Use ${MODELS.map((m) => `\`${m.name}\``).join(", ")}, ` +
    "a provider (`claude` or `codex`), a Claude version (`opus 5.5`), or a full model ID. Effort goes last and must be supported by that model." };
}

// Resolve once, before installing a CLI. A provider change picks its default model.
export function resolveFixer(choice: Partial<Omit<Fixer, "provider">> & { provider?: string } = {}, fallback: Fixer = DEFAULT_FIXER): Fixer | { error: string } {
  const selectedProvider = choice.provider?.trim().toLowerCase() || undefined;
  if (selectedProvider !== undefined && !isProvider(selectedProvider)) return { error: `The provider \`${choice.provider}\` is invalid. Use ${PROVIDERS.join(", ")}.` };
  const model = choice.model || (selectedProvider && selectedProvider !== providerOf(fallback.model) ? defaultModel(selectedProvider) : fallback.model);
  const provider = providerOf(model);
  if (!isModelId(model) || (selectedProvider && selectedProvider !== provider)) return { error: `The model \`${model}\` doesn't belong to the selected provider.` };
  const effort = choice.effort || (effortsFor(model).some((e) => e === fallback.effort) ? fallback.effort : "high");
  if (!effortsFor(model).some((e) => e === effort)) return { error: `The model \`${model}\` doesn't support \`${effort}\` effort. Use ${effortsFor(model).join(", ")}.` };
  return { provider, model, effort };
}
