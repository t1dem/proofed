import { pushSecrets } from "./api";
import type { UserRow } from "./auth";
import { installationToken, verifySignature } from "./github";
import type { Env } from "./index";
import { saveRun } from "./runs";
import { openSetupPr } from "./setup";

type Repo = { full_name: string };
type Payload = {
  action?: string;
  installation?: { id: number };
  sender?: { id: number };
  repositories?: Repo[];
  repositories_added?: Repo[];
  issue?: { number: number; title?: string; pull_request?: object };
  pull_request?: { number: number };
  comment?: { body: string; html_url: string };
  repository?: { full_name: string };
};

const MARKER = "<!-- proofed -->";

// Reads the state out of the comment Proofed itself posts on the PR (see src/report.ts in the action).
function readReport(body: string) {
  const headline =
    body
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("<!--") && !l.startsWith("#")) ?? "";
  const state = body.includes("⏳ **Claude is working")
    ? "fixing"
    : /scenarios broke on this PR/.test(headline)
      ? "failing"
      : /couldn't finish/.test(headline)
        ? "blocked"
        : "passing";
  return { state, headline: headline.replace(/\*\*/g, "") };
}

export async function handleWebhook(request: Request, env: Env, ctx: ExecutionContext) {
  const body = await request.text();
  if (!(await verifySignature(env.GITHUB_WEBHOOK_SECRET, body, request.headers.get("x-hub-signature-256")))) {
    return new Response("bad signature", { status: 401 });
  }
  const event = request.headers.get("x-github-event");
  const payload = JSON.parse(body) as Payload;

  // A repo just got Proofed: open its setup PR and, if the installer already saved keys, add them.
  const added =
    event === "installation" && payload.action === "created"
      ? payload.repositories
      : event === "installation_repositories" && payload.action === "added"
        ? payload.repositories_added
        : undefined;
  if (added?.length && payload.installation) {
    const installationId = payload.installation.id;
    ctx.waitUntil(
      (async () => {
        const token = await installationToken(env, installationId);
        const user = payload.sender
          ? await env.DB.prepare("SELECT * FROM users WHERE id = ?1").bind(payload.sender.id).first<UserRow>()
          : null;
        for (const repo of added) {
          const result = await openSetupPr(token, repo).catch((e: unknown) => ({ error: String(e) }));
          console.log("setup", repo.full_name, JSON.stringify(result));
          if (user) await pushSecrets(env, user, repo.full_name, installationId).catch((e: unknown) => console.log("secrets", String(e)));
        }
      })(),
    );
  }

  if (event === "issue_comment" && payload.issue?.pull_request && payload.comment?.body.includes(MARKER) && payload.repository) {
    const { state, headline } = readReport(payload.comment.body);
    const repo = payload.repository.full_name;
    await env.DB.prepare(
      `INSERT INTO reports (repo, pr, state, headline, url, updated_at, title) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(repo, pr) DO UPDATE SET state = ?3, headline = ?4, url = ?5, updated_at = ?6, title = ?7`,
    )
      .bind(repo, payload.issue.number, state, headline, payload.comment.html_url, Date.now(), payload.issue.title ?? null)
      .run();
    if (payload.installation) {
      const { id } = payload.installation;
      const { number } = payload.issue;
      const { body: comment } = payload.comment;
      ctx.waitUntil(
        installationToken(env, id)
          .then((token) => saveRun(env, token, repo, number, comment))
          .catch((e: unknown) => console.log("run", repo, number, String(e))),
      );
    }
  }

  // A closed pull request leaves the inbox; reopening brings it back.
  if (event === "pull_request" && payload.pull_request && payload.repository && (payload.action === "closed" || payload.action === "reopened")) {
    await env.DB.prepare("UPDATE reports SET closed = ?1 WHERE repo = ?2 AND pr = ?3")
      .bind(payload.action === "closed" ? 1 : 0, payload.repository.full_name, payload.pull_request.number)
      .run();
  }

  return new Response("ok");
}
