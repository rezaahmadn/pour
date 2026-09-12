import { Hono } from "hono";
import { html } from "hono/html";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";
import { page } from "../layout";
import { excerptOf } from "../post";
import { formatDate } from "./post";

/**
 * A single handle from the Worker environment is the admin. Anyone else gets a
 * plain 404 rather than a refusal, so the route is not advertised to the people
 * most likely to go looking for it.
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get("user");
  const admin = c.env.ADMIN_HANDLE;
  if (!user || !admin || user.handle !== admin) return c.notFound();
  await next();
});

const formLimit = bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.text("Too large", 413) });

type PostRow = {
  id: string;
  body: string;
  created_at: number;
  hidden: number;
  handle: string;
};

type UserRow = { handle: string; frozen: number; created_at: number; posts: number };

function toggle(action: string, field: string, value: 0 | 1, label: string) {
  return html`<form method="post" action="${action}" class="inline-form">
    <input type="hidden" name="${field}" value="${value}" />
    <button type="submit" class="linkish">${label}</button>
  </form>`;
}

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.get("/admin", requireAdmin, async (c) => {
  const { results: posts } = await c.env.DB.prepare(
    "SELECT posts.id AS id, posts.body AS body, posts.created_at AS created_at, " +
      "posts.hidden AS hidden, users.handle AS handle " +
      "FROM posts JOIN users ON users.id = posts.user_id " +
      "ORDER BY posts.rowid DESC LIMIT 100",
  ).all<PostRow>();

  const { results: users } = await c.env.DB.prepare(
    "SELECT users.handle AS handle, users.frozen AS frozen, users.created_at AS created_at, " +
      "COUNT(posts.id) AS posts FROM users LEFT JOIN posts ON posts.user_id = users.id " +
      "GROUP BY users.id ORDER BY users.created_at DESC LIMIT 100",
  ).all<UserRow>();

  return c.html(
    page({
      title: "admin",
      user: c.get("user"),
      body: html`<h1>admin</h1>
        <p class="note">
          Hiding takes a post out of view and leaves the record intact, so
          <a href="/verify">the chain</a> still verifies. Freezing stops an account publishing
          and leaves what it already published alone. Neither deletes anything.
        </p>

        <h2>Posts</h2>
        ${posts.length
          ? html`<ul class="timeline">
              ${posts.map(
                (p) => html`<li>
                  <p class="meta">
                    <a href="/p/${p.id}">${formatDate(p.created_at)}</a> by @${p.handle}
                    ${p.hidden ? html`<span class="flag">hidden</span>` : ""}
                  </p>
                  <p class="excerpt">${excerptOf(p.body, 120)}</p>
                  ${toggle(`/admin/posts/${p.id}`, "hidden", p.hidden ? 0 : 1, p.hidden ? "Unhide" : "Hide")}
                </li>`,
              )}
            </ul>`
          : html`<p class="note">No posts yet.</p>`}

        <h2>Accounts</h2>
        <ul class="timeline">
          ${users.map(
            (u) => html`<li>
              <p class="meta">
                @${u.handle} · joined ${formatDate(u.created_at)} · ${u.posts}
                ${u.posts === 1 ? "post" : "posts"}
                ${u.frozen ? html`<span class="flag">frozen</span>` : ""}
              </p>
              ${toggle(
                `/admin/users/${u.handle}`,
                "frozen",
                u.frozen ? 0 : 1,
                u.frozen ? "Unfreeze" : "Freeze",
              )}
            </li>`,
          )}
        </ul>`,
    }),
  );
});

// The only UPDATE the codebase performs on posts, and it touches one column.
adminRoutes.post("/admin/posts/:id", requireAdmin, formLimit, async (c) => {
  const form = await c.req.parseBody();
  const hidden = form.hidden === "1" ? 1 : 0;
  await c.env.DB.prepare("UPDATE posts SET hidden = ? WHERE id = ?")
    .bind(hidden, c.req.param("id"))
    .run();
  return c.redirect("/admin");
});

adminRoutes.post("/admin/users/:handle", requireAdmin, formLimit, async (c) => {
  const form = await c.req.parseBody();
  const frozen = form.frozen === "1" ? 1 : 0;
  await c.env.DB.prepare("UPDATE users SET frozen = ? WHERE handle = ?")
    .bind(frozen, c.req.param("handle"))
    .run();
  return c.redirect("/admin");
});
