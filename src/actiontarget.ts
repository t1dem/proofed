// Resolve after checkout: target fields may live in scenario frontmatter rather than action inputs.
import { appendFileSync } from "node:fs";
import { checkSelection } from "./checkselection.ts";
import { env } from "./env.ts";
import { needsWeb, targetScenarios } from "./fixtarget.ts";
import { ctx, getPullRequest, readEvent, type PullRequest } from "./github.ts";
import { parseCommand } from "./requests.ts";

type Event = { pull_request: PullRequest; issue: { number: number; pull_request?: object }; comment: { body: string } };
const event = readEvent<Event>();
const { repo } = ctx();
const pr = event.pull_request ?? (repo && event.issue?.pull_request ? await getPullRequest(repo, event.issue.number) : undefined);
const { selected } = checkSelection(pr, event.comment ? parseCommand(event.comment.body) : undefined,
  process.env.PROOFED_SHA || pr?.head.sha || "local", process.env.PROOFED_BASE_SHA);
const web = needsWeb(targetScenarios(selected));
if (web && !process.env.PROOFED_URL?.trim()) throw new Error("url is required for web checks.");
const line = `web=${web}\n`;
if (process.env.GITHUB_OUTPUT) appendFileSync(env("GITHUB_OUTPUT"), line);
console.log(line.trim());
