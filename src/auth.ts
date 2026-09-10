import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, User } from "./env";
import { nowSec, randomHex } from "./crypto";

export const SESSION_COOKIE = "session";
export const SESSION_TTL_SEC = 30 * 24 * 60 * 60;

function isHttps(c: Context<AppEnv>): boolean {
  return new URL(c.req.url).protocol === "https:";
}

/** Loads the current user from the session cookie into c.get("user"). Never blocks a request. */
export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  c.set("user", null);
  const id = getCookie(c, SESSION_COOKIE);
  if (id) {
    const user = await c.env.DB.prepare(
      "SELECT users.id AS id, users.handle AS handle, users.frozen AS frozen " +
        "FROM sessions JOIN users ON users.id = sessions.user_id " +
        "WHERE sessions.id = ? AND sessions.expires_at > ?",
    )
      .bind(id, nowSec())
      .first<User>();
    c.set("user", user ?? null);
  }
  await next();
});

/** Redirects to /login when there is no user. Put it before handlers that need an account. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("user")) return c.redirect("/login");
  await next();
});

/** Builds the INSERT for a new session. Caller runs it (alone or inside a batch), then calls setSessionCookie. */
export function newSessionStatement(
  c: Context<AppEnv>,
  userId: string,
): { id: string; stmt: D1PreparedStatement } {
  const id = randomHex(32);
  const stmt = c.env.DB.prepare(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
  ).bind(id, userId, nowSec() + SESSION_TTL_SEC);
  return { id, stmt };
}

export function setSessionCookie(c: Context<AppEnv>, id: string): void {
  setCookie(c, SESSION_COOKIE, id, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export function clientIp(c: Context<AppEnv>): string {
  return c.req.header("cf-connecting-ip") ?? "0.0.0.0";
}
