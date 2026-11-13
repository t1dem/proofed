// Sign in with GitHub, through the Proofed GitHub App's own OAuth. The user token it returns can
// list exactly the installations and repos this user can see, which is what the dashboard shows.
import { decrypt, encrypt, randomId } from "./crypto";
import { gh } from "./github";
import type { Env } from "./index";

const SESSION_COOKIE = "proofed_session";
const STATE_COOKIE = "proofed_oauth_state";
const SESSION_DAYS = 30;

export type UserRow = {
  id: number;
  login: string;
  avatar: string | null;
  token: string | null;
  refresh: string | null;
  token_expires: number | null;
  lt_username: string | null;
  lt_key: string | null;
  claude_token: string | null;
};

const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const readCookie = (request: Request, name: string) =>
  request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);

export function login(request: Request, env: Env) {
  const state = randomId();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", new URL("/auth/callback", request.url).href);
  url.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { location: url.href, "set-cookie": cookie(STATE_COOKIE, state, 600) } });
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };

async function exchange(env: Env, params: Record<string, string>) {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, ...params }),
  });
  return (await res.json()) as TokenResponse;
}

export async function callback(request: Request, env: Env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== readCookie(request, STATE_COOKIE)) {
    return new Response("Sign-in expired. Go back and try again.", { status: 400 });
  }
  const token = await exchange(env, { code });
  if (!token.access_token) return new Response(`GitHub refused the sign-in: ${token.error ?? "no token"}`, { status: 400 });

  const me = await gh<{ id: number; login: string; avatar_url: string }>(token.access_token, "GET", "/user");
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, login, avatar, token, refresh, token_expires, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
     ON CONFLICT(id) DO UPDATE SET login = ?2, avatar = ?3, token = ?4, refresh = ?5, token_expires = ?6, updated_at = ?7`,
  )
    .bind(
      me.id,
      me.login,
      me.avatar_url,
      await encrypt(env.SECRETS_KEY, token.access_token),
      token.refresh_token ? await encrypt(env.SECRETS_KEY, token.refresh_token) : null,
      token.expires_in ? now + token.expires_in * 1000 : null,
      now,
    )
    .run();

  const session = randomId();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?1, ?2, ?3)")
    .bind(session, me.id, now + SESSION_DAYS * 86_400_000)
    .run();

  const headers = new Headers({ location: "/app" });
  headers.append("set-cookie", cookie(SESSION_COOKIE, session, SESSION_DAYS * 86_400));
  headers.append("set-cookie", cookie(STATE_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}

export async function logout(request: Request, env: Env) {
  const session = readCookie(request, SESSION_COOKIE);
  if (session) await env.DB.prepare("DELETE FROM sessions WHERE id = ?1").bind(session).run();
  return new Response(null, { status: 302, headers: { location: "/", "set-cookie": cookie(SESSION_COOKIE, "", 0) } });
}

export async function currentUser(request: Request, env: Env) {
  const session = readCookie(request, SESSION_COOKIE);
  if (!session) return undefined;
  return (
    (await env.DB.prepare(
      `SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id = ?1 AND sessions.expires_at > ?2`,
    )
      .bind(session, Date.now())
      .first<UserRow>()) ?? undefined
  );
}

// GitHub App user tokens last eight hours; refresh quietly when one is about to run out.
export async function userToken(env: Env, user: UserRow) {
  const token = await decrypt(env.SECRETS_KEY, user.token);
  if (token && (!user.token_expires || user.token_expires > Date.now() + 60_000)) return token;

  const refresh = await decrypt(env.SECRETS_KEY, user.refresh);
  if (!refresh) return undefined;
  const next = await exchange(env, { grant_type: "refresh_token", refresh_token: refresh });
  if (!next.access_token) return undefined;
  await env.DB.prepare("UPDATE users SET token = ?2, refresh = ?3, token_expires = ?4, updated_at = ?5 WHERE id = ?1")
    .bind(
      user.id,
      await encrypt(env.SECRETS_KEY, next.access_token),
      next.refresh_token ? await encrypt(env.SECRETS_KEY, next.refresh_token) : user.refresh,
      next.expires_in ? Date.now() + next.expires_in * 1000 : null,
      Date.now(),
    )
    .run();
  return next.access_token;
}
