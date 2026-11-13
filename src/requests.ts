import type { Scenario } from "./scenarios.ts";

// "/proofed" in a PR comment re-runs the check, which also gives a PR opened before Proofed was
// added its first run. "/proofed <what to check>" has Kane check just that. A slash command,
// not "@proofed": that name belongs to someone else on GitHub and would mention them.
const COMMAND = /(?:^|\s)\/proofed\b([\s\S]*)/i;

export function parseCommand(comment: string): string | undefined {
  const match = COMMAND.exec(comment);
  return match ? match[1]!.trim() : undefined;
}

// What the PR description asks to have checked. HTML comments (PR templates) are dropped, and a
// long description is a changelog rather than a request, so it's left alone.
export function descriptionRequest(body: string | null | undefined) {
  const text = (body ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();
  return text && text.length <= 1500 ? text : undefined;
}

export function askedScenario(where: "description" | "comment", text: string): Scenario {
  return {
    id: `asked-in-${where}`,
    file: "",
    name: where === "description" ? "What the PR description asks" : "What the /proofed comment asks",
    paths: [],
    url: "/",
    objective:
      `The author of this pull request asked for this to be checked:\n\n${text}\n\n` +
      "Open the app and check exactly that in the browser, the way a user would. It passes only if what they " +
      "asked about actually works; the page loading is not enough.",
  };
}
