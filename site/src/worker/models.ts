// The models the fixer can run Claude Code with, set per repo. Shared by the dashboard and the API.
export const MODELS = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-fable-5-2", label: "Fable 5.2" },
] as const;
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

// What the fix action uses when the repo sets nothing.
export const DEFAULT_FIXER = { model: "claude-haiku-5-5", effort: "xhigh" };

export type Fixer = { model: string; effort: string };
