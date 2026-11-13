export type Env = {
  ASSETS: Fetcher;
  GITHUB_APP_SLUG: string;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/install") {
      return Response.redirect(`https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`, 302);
    }

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
