import { Hono } from "hono";
import { html, raw } from "hono/html";
import type { AppEnv } from "../env";
import { renderMarkdown } from "../markdown";
import { page } from "../layout";

type PostRow = {
  id: string;
  body: string;
  created_at: number;
  handle: string;
};

/** ISO date, and a machine readable datetime for the <time> element. */
export function formatDate(createdAt: number): string {
  return new Date(createdAt * 1000).toISOString().slice(0, 10);
}

export function postMeta(row: PostRow, tags: string[]) {
  return html`<p class="meta">
    <a href="/p/${row.id}"><time datetime="${new Date(row.created_at * 1000).toISOString()}"
        >${formatDate(row.created_at)}</time
      ></a>
    by @${row.handle}
    ${tags.length
      ? html`<span class="tags">${tags.map((t) => html`<span class="tag">#${t}</span>`)}</span>`
      : ""}
  </p>`;
}

export const postRoutes = new Hono<AppEnv>();

postRoutes.get("/p/:id", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT posts.id AS id, posts.body AS body, posts.created_at AS created_at, " +
      "users.handle AS handle FROM posts JOIN users ON users.id = posts.user_id " +
      "WHERE posts.id = ? AND posts.hidden = 0",
  )
    .bind(c.req.param("id"))
    .first<PostRow>();
  if (!row) return c.notFound();

  const { results: tagRows } = await c.env.DB.prepare(
    "SELECT tag FROM tags WHERE post_id = ? ORDER BY tag",
  )
    .bind(row.id)
    .all<{ tag: string }>();
  const tags = tagRows.map((t) => t.tag);

  // renderMarkdown escapes any HTML in the body, so its output is safe to inline.
  // Everything else on this page goes through the escaping template as usual.
  return c.html(
    page({
      title: `@${row.handle} on pour`,
      user: c.get("user"),
      body: html`${postMeta(row, tags)}
        <article class="post">${raw(renderMarkdown(row.body))}</article>`,
    }),
  );
});
