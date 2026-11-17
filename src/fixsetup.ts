// Why the report's fix box would do nothing in this repo: a workflow installed before Codex was an
// option passes the action no Codex key, and its condition reacts only to the Claude box.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { providerLabel, type Provider } from "./models.ts";

export type FixSetup = { note: string; comment: boolean };

const INPUTS: Record<Provider, [input: string, secret: string]> = {
  claude: ["claude-code-oauth-token", "CLAUDE_CODE_OAUTH_TOKEN"],
  codex: ["codex-api-key", "CODEX_API_KEY"],
};

// GITHUB_WORKFLOW_REF is owner/repo/.github/workflows/proofed.yml@refs/heads/main.
const workflowFile = (ref?: string) => /^[^/]+\/[^/]+\/(.+?)@/.exec(ref ?? "")?.[1];

export function fixSetup(provider: Provider, env: NodeJS.ProcessEnv = process.env): FixSetup | undefined {
  const label = providerLabel(provider);
  const file = workflowFile(env.GITHUB_WORKFLOW_REF);
  const [input, secret] = INPUTS[provider];
  // Only the check step says whether the key was passed; elsewhere the flag is unset.
  if ((provider === "codex" ? env.PROOFED_CODEX : env.PROOFED_CLAUDE) === "false") {
    return {
      note: `${label} is selected in Proofed, but \`${file ?? "the workflow"}\` gives the action no \`${input}\`. Add \`${input}: \${{ secrets.${secret} }}\` to its Proofed step to fix with ${label}.`,
      comment: false,
    };
  }
  if (provider !== "codex" || !file) return undefined;
  let text: string;
  try {
    text = readFileSync(join(env.GITHUB_WORKSPACE ?? process.cwd(), file), "utf8");
  } catch {
    return undefined;
  }
  if (!text.includes("Fix with Claude**") || text.includes("Fix with Codex**")) return undefined;
  return {
    note: `\`${file}\` starts a fix only when **Fix with Claude** is ticked, so there is no box here. Comment \`/proofed fix\`, or add \`|| contains(github.event.comment.body, '- [x] **Fix with Codex**')\` next to its Claude condition.`,
    comment: true,
  };
}
