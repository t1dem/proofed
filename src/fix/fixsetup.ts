// Why the report's fix box would do nothing in this repo: a workflow installed before Codex was an
// option passes the action no Codex credentials, and its condition reacts only to the Claude box.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { providerLabel, type Provider } from "./models.ts";

export type FixSetup = { note: string; comment: boolean };

// GITHUB_WORKFLOW_REF is owner/repo/.github/workflows/proofed.yml@refs/heads/main.
const workflowFile = (ref?: string) => /^[^/]+\/[^/]+\/(.+?)@/.exec(ref ?? "")?.[1];

function workflowConditions(workflow: string) {
  const lines = workflow.split(/\r?\n/);
  const conditions: string[] = [];
  const withoutComment = (line: string) => line.replace(/'(?:''|[^'])*'|"(?:\\.|[^"\\])*"|(^|\s)#.*$/g, (match, comment) => comment === undefined ? match : "");
  for (let i = 0; i < lines.length; i++) {
    const property = /^(\s*(?:-\s+)?)([\w-]+):\s*(.*)$/.exec(withoutComment(lines[i]!));
    if (!property) continue;
    let value = property[3]!;
    const block = /^[>|][+-]?$/.test(value.trim());
    if (block || property[2] === "if") {
      const indent = property[1]!.length;
      if (block) value = "";
      while (i + 1 < lines.length) {
        const continuation = withoutComment(lines[i + 1]!);
        if (continuation.trim() && continuation.search(/\S/) <= indent) break;
        value += ` ${continuation.trim()}`;
        i++;
      }
    }
    if (property[2] === "if") conditions.push(value);
  }
  return conditions;
}

const checksFor = (label: string) => new RegExp(`\\bcontains\\(\\s*github\\.event\\.comment\\.body\\s*,\\s*'- \\[x\\] \\*\\*Fix with ${label}\\*\\*'\\s*\\)`, "i");
const commandCondition = /(!\s*)?\b(?:contains|startsWith)\(\s*github\.event\.comment\.body\s*,\s*'\/proofed(?:\s+fix)?\s*'\s*\)/i;
const editedOnly = /\bgithub\.event\.action\s*(?:==\s*'edited'|!=\s*'created')/i;
const created = /\bgithub\.event\.action\s*==\s*'created'/i;

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
  const conditions = workflowConditions(text);
  const claude = conditions.filter((condition) => checksFor("Claude").test(condition));
  if (!claude.length || conditions.some((condition) => checksFor("Codex").test(condition))) return undefined;
  // A command needs a branch that accepts a new comment without a ticked box.
  const comment = claude.every((condition) => condition.split("||").some((branch) => {
    const command = commandCondition.exec(branch);
    return command && !command[1] && !editedOnly.test(branch) && !checksFor("Claude").test(branch) &&
      (!editedOnly.test(condition) || created.test(branch));
  }));
  const change = "add `|| contains(github.event.comment.body, '- [x] **Fix with Codex**')` next to its Claude condition.";
  return {
    note: `\`${file}\` supports the **Fix with Claude** checkbox. ${comment ? `Comment \`/proofed fix\`, or ${change}` : `To show the Codex box, ${change}`}`,
    comment,
  };
}
