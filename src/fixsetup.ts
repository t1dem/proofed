// Why the report's fix box would do nothing in this repo: a workflow installed before Codex was an
// option passes the action no Codex credentials, and its condition reacts only to the Claude box.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { providerLabel, type Provider } from "./models.ts";

export type FixSetup = { note: string; comment: boolean };

// GITHUB_WORKFLOW_REF is owner/repo/.github/workflows/proofed.yml@refs/heads/main.
const workflowFile = (ref?: string) => /^[^/]+\/[^/]+\/(.+?)@/.exec(ref ?? "")?.[1];

export function fixSetup(provider: Provider, env: NodeJS.ProcessEnv = process.env): FixSetup | undefined {
  const label = providerLabel(provider);
  const file = workflowFile(env.GITHUB_WORKFLOW_REF);
  // Only the check step says whether credentials were passed; elsewhere the flag is unset.
  if ((provider === "codex" ? env.PROOFED_CODEX : env.PROOFED_CLAUDE) === "false") {
    const inputs = provider === "codex"
      ? "`codex-api-key: ${{ secrets.CODEX_API_KEY }}` or `codex-auth-json: ${{ secrets.CODEX_AUTH_JSON }}`"
      : "`claude-code-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`";
    return {
      note: `${label} is selected in Proofed. To fix with ${label}, add ${inputs} to the Proofed step in \`${file ?? "the workflow"}\`.`,
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
