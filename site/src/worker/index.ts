import { handleActionsPush } from "./actions";
import { handleApi } from "./api";
import { callback, login, logout } from "./auth";
import { handleLivePost } from "./live";
import type { AppEnv } from "./github";
import { handleTry } from "./try";
import { handleWebhook } from "./webhook";

export type Env = AppEnv & {
  ASSETS: Fetcher;
  DB: D1Database;
  GITHUB_APP_SLUG: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SECRETS_KEY: string;
  // "Break it yourself" (try.ts): the demo repository visitors open prepared pull requests on, and how many a day.
  TRY_REPO: string;
  TRY_DAILY: string;
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (pathname === "/install") return Response.redirect(`https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`, 302);
    if (pathname === "/login") return login(request, env);
    if (pathname === "/auth/callback") return callback(request, env);
    if (pathname === "/logout") return logout(request, env);
    if (pathname === "/api/health") return Response.json({ ok: true });
    if (pathname === "/api/github/webhook" && request.method === "POST") return handleWebhook(request, env, ctx);
    // Called by the action, not the dashboard: it carries a GitHub Actions token, not a session.
    if (pathname === "/api/actions/push" && request.method === "POST") {
      return handleActionsPush(request, env).catch((e: unknown) => {
        console.error(pathname, e);
        return Response.json({ error: "Something went wrong talking to GitHub. Try again." }, { status: 502 });
      });
    }
    // The action reporting a run as it goes (src/report/live.ts at the repo root), with the same kind of token.
    if ((pathname === "/api/actions/live" || pathname === "/api/actions/live/frame") && request.method === "POST") {
      return handleLivePost(request, env).catch((e: unknown) => {
        console.error(pathname, e);
        return Response.json({ error: "Couldn't keep that." }, { status: 500 });
      });
    }
    // Public: no session (try.ts says what keeps it narrow).
    if (pathname === "/api/try" || pathname.startsWith("/api/try/")) {
      return handleTry(request, env, pathname).catch((e: unknown) => {
        console.error(pathname, e);
        return Response.json({ error: "Something went wrong talking to GitHub. Try again." }, { status: 502 });
      });
    }
    if (pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, pathname);
      } catch (e) {
        console.error(pathname, e);
        return Response.json({ error: "Something went wrong talking to GitHub. Try again." }, { status: 502 });
      }
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
