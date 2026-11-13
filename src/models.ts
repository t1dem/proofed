// The models "Fix with Claude" can run, by short name. Also imported by the dashboard (site/),
// so this file has no imports and nothing Node-specific.
export const MODELS = [
  { name: "haiku", id: "claude-haiku-5-5" },
  { name: "sonnet", id: "claude-sonnet-5-5" },
  { name: "opus", id: "claude-opus-5-5" },
  { name: "fable", id: "claude-fable-5-2" },
] as const;

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export type Fixer = { model: string; effort: string };

// What the fixer uses when the repo sets nothing.
export const DEFAULT_FIXER: Fixer = { model: "claude-haiku-5-5", effort: "xhigh" };

export const isEffort = (word: string): word is Effort => (EFFORTS as readonly string[]).includes(word);

// A full model ID as Claude Code takes it, e.g. claude-opus-5-1. Whether it exists is up to Anthropic.
export const isModelId = (text: string) => /^claude-[a-z0-9][a-z0-9.-]{2,60}$/.test(text);

// "claude-opus-5-5" → "Opus 5.5". An ID that doesn't follow that pattern is shown as is.
export function modelLabel(id: string) {
  const match = /^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?$/.exec(id);
  if (!match) return id;
  const [, family = "", major, minor] = match;
  return `${family[0]!.toUpperCase()}${family.slice(1)} ${major}.${minor}`;
}

// Who fixed it, for the PR comment: "Claude Opus 5.5, high effort". An unknown ID is shown as written.
export function describeFixer({ model, effort }: Fixer) {
  const label = modelLabel(model);
  return `${label === model ? `\`${model}\`` : `Claude ${label}`}, ${effort} effort`;
}

export type ModelChoice = { model: string } | { error: string };

// "opus" → the latest Opus; "opus 5.1" → claude-opus-5-1; "claude-opus-5-1" → as written.
export function parseModel(words: string[]): ModelChoice {
  const [first = "", version, ...rest] = words.map((w) => w.toLowerCase());
  const family = MODELS.find((m) => m.name === first);
  if (family && version === undefined) return { model: family.id };
  if (family && rest.length === 0 && version && /^\d+([.-]\d+)?$/.test(version)) {
    return { model: `claude-${family.name}-${version.replace(".", "-")}` };
  }
  if (words.length === 1 && isModelId(first)) return { model: first };
  return {
    error:
      `Proofed doesn't know the model \`${words.join(" ")}\`. Use ${MODELS.map((m) => `\`${m.name}\``).join(", ")} ` +
      "for the latest version, add a version (`opus 5.5`), or give a full model ID (`claude-opus-5-5`). " +
      `Effort goes last and is optional: ${EFFORTS.map((e) => `\`${e}\``).join(", ")}.`,
  };
}
