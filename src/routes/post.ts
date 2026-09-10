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
  hidden: number;
  hash: string;
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
  // Blanked in SQL rather than in the template, so a hidden post's contents cannot
  // reach the page by mistake. The row itself still resolves, because the entry is
  // still in the ledger and its link should not rot.
  const row = await c.env.DB.prepare(
    "SELECT posts.id AS id, posts.created_at AS created_at, posts.hidden AS hidden, " +
      "posts.hash AS hash, " +
      "CASE WHEN posts.hidden = 1 THEN '' ELSE posts.body END AS body, " +
      "CASE WHEN posts.hidden = 1 THEN '' ELSE users.handle END AS handle " +
      "FROM posts JOIN users ON users.id = posts.user_id WHERE posts.id = ?",
  )
    .bind(c.req.param("id"))
    .first<PostRow>();
  if (!row) return c.notFound();

  if (row.hidden) {
    return c.html(
      page({
        title: "entry hidden",
        user: c.get("user"),
        body: html`<p class="meta">
            <time datetime="${new Date(row.created_at * 1000).toISOString()}"
              >${formatDate(row.created_at)}</time
            >
            <span class="flag">entry hidden</span>
          </p>
          <p>This entry was hidden. It has not been removed from the record.</p>
          <p class="note">
            Its hash still holds the chain together:
            <code>${row.hash}</code>. See <a href="/verify">verify</a>.
          </p>`,
      }),
      410,
    );
  }

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
