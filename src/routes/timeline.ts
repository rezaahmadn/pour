import { Hono } from "hono";
import { html } from "hono/html";
import type { AppEnv } from "../env";
import { excerptOf } from "../post";
import { page } from "../layout";
import { formatDate, postMeta } from "./post";

export const PAGE_SIZE = 20;

export type FeedRow = {
  id: string;
  body: string;
  created_at: number;
  handle: string;
  hidden: number;
  hash: string;
  tags: string | null;
  rowid: number;
};

/**
 * One query serves every view. The body, author and tags of a hidden post are
 * blanked in SQL rather than in the template, so a rendering mistake cannot leak
 * them, and the tag list arrives joined rather than as a second round trip.
 */
const SELECT_POSTS =
  "SELECT posts.rowid AS rowid, posts.id AS id, posts.created_at AS created_at, " +
  "posts.hidden AS hidden, posts.hash AS hash, " +
  "CASE WHEN posts.hidden = 1 THEN '' ELSE posts.body END AS body, " +
  "CASE WHEN posts.hidden = 1 THEN '' ELSE users.handle END AS handle, " +
  "CASE WHEN posts.hidden = 1 THEN NULL ELSE " +
  "  (SELECT group_concat(tag) FROM tags WHERE tags.post_id = posts.id) END AS tags " +
  "FROM posts JOIN users ON users.id = posts.user_id ";

/** Cursor paging on rowid. Stable while people keep publishing, unlike an offset. */
function cursorClause(before: number | null): string {
  return before === null ? "" : "AND posts.rowid < ? ";
}

export function parseBefore(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function tagsOf(row: FeedRow): string[] {
  return row.tags ? row.tags.split(",") : [];
}

export async function globalPosts(db: D1Database, before: number | null, limit: number) {
  const sql =
    SELECT_POSTS +
    "WHERE 1 = 1 " +
    cursorClause(before) +
    "ORDER BY posts.rowid DESC LIMIT ?";
  const binds = before === null ? [limit] : [before, limit];
  const { results } = await db.prepare(sql).bind(...binds).all<FeedRow>();
  return results;
}

export async function handlePosts(
  db: D1Database,
  handle: string,
  before: number | null,
  limit: number,
) {
  // A hidden post is left out here rather than shown as a placeholder. On a page
  // that is already filtered to one author, a placeholder would announce that this
  // person in particular had something taken down.
  const sql =
    SELECT_POSTS +
    "WHERE users.handle = ? AND posts.hidden = 0 " +
    cursorClause(before) +
    "ORDER BY posts.rowid DESC LIMIT ?";
  const binds = before === null ? [handle, limit] : [handle, before, limit];
  const { results } = await db.prepare(sql).bind(...binds).all<FeedRow>();
  return results;
}

export async function tagPosts(
  db: D1Database,
  tag: string,
  before: number | null,
  limit: number,
) {
  const sql =
    SELECT_POSTS +
    "WHERE posts.hidden = 0 " +
    "AND EXISTS (SELECT 1 FROM tags WHERE tags.post_id = posts.id AND tags.tag = ?) " +
    cursorClause(before) +
    "ORDER BY posts.rowid DESC LIMIT ?";
  const binds = before === null ? [tag, limit] : [tag, before, limit];
  const { results } = await db.prepare(sql).bind(...binds).all<FeedRow>();
  return results;
}

function entry(row: FeedRow) {
  if (row.hidden) {
    return html`<li class="hidden-entry">
      <p class="meta">
        <a href="/p/${row.id}">${formatDate(row.created_at)}</a>
        <span class="flag">entry hidden</span>
      </p>
      <p class="excerpt">
        This entry was hidden. Its hash stays in the chain:
        <code>${row.hash.slice(0, 16)}…</code>
      </p>
    </li>`;
  }
  return html`<li>
    ${postMeta(row, tagsOf(row))}
    <p class="excerpt"><a href="/p/${row.id}">${excerptOf(row.body)}</a></p>
  </li>`;
}

export function postList(rows: FeedRow[], basePath: string, empty: string) {
  if (!rows.length) return html`<p class="note">${empty}</p>`;
  const last = rows[rows.length - 1];
  const older = rows.length === PAGE_SIZE && last ? last.rowid : null;
  const sep = basePath.includes("?") ? "&" : "?";
  return html`<ul class="timeline">
      ${rows.map(entry)}
    </ul>
    ${older ? html`<p class="pager"><a href="${basePath}${sep}before=${older}">Older</a></p>` : ""}`;
}

export const timelineRoutes = new Hono<AppEnv>();

timelineRoutes.get("/", async (c) => {
  const before = parseBefore(c.req.query("before"));
  const rows = await globalPosts(c.env.DB, before, PAGE_SIZE);
  return c.html(
    page({
      title: "pour",
      user: c.get("user"),
      head: html`<link rel="alternate" type="application/rss+xml" title="pour" href="/feed.xml" />`,
      body: html`${postList(rows, "/", "Nothing here yet. Be the first to write something.")}
        <p class="note"><a href="/feed.xml">RSS</a> · <a href="/verify">verify the chain</a></p>`,
    }),
  );
});

timelineRoutes.get("/:at{@[A-Za-z0-9_]+}", async (c) => {
  const handle = (c.req.param("at") ?? "").slice(1).toLowerCase();
  const before = parseBefore(c.req.query("before"));
  const rows = await handlePosts(c.env.DB, handle, before, PAGE_SIZE);
  const exists = await c.env.DB.prepare("SELECT 1 AS x FROM users WHERE handle = ?")
    .bind(handle)
    .first();
  if (!exists) return c.notFound();

  return c.html(
    page({
      title: `@${handle} on pour`,
      description: `Everything @${handle} has published on pour.`,
      user: c.get("user"),
      head: html`<link
        rel="alternate"
        type="application/rss+xml"
        title="@${handle}"
        href="/@${handle}/feed.xml"
      />`,
      body: html`<h1>@${handle}</h1>
        ${postList(rows, `/@${handle}`, "Nothing published yet.")}
        <p class="note"><a href="/@${handle}/feed.xml">RSS</a></p>`,
    }),
  );
});

timelineRoutes.get("/tag/:tag", async (c) => {
  const tag = (c.req.param("tag") ?? "").toLowerCase();
  const before = parseBefore(c.req.query("before"));
  const rows = await tagPosts(c.env.DB, tag, before, PAGE_SIZE);
  return c.html(
    page({
      title: `#${tag} on pour`,
      description: `Everything tagged #${tag} on pour.`,
      user: c.get("user"),
      head: html`<link
        rel="alternate"
        type="application/rss+xml"
        title="#${tag}"
        href="/tag/${tag}/feed.xml"
      />`,
      body: html`<h1>#${tag}</h1>
        ${postList(rows, `/tag/${tag}`, "Nothing tagged this yet.")}
        <p class="note"><a href="/tag/${tag}/feed.xml">RSS</a></p>`,
    }),
  );
});
