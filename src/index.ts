import { Hono } from "hono";
import { html } from "hono/html";
import { csrf } from "hono/csrf";
import type { AppEnv } from "./env";
import { sessionMiddleware } from "./auth";
import { page } from "./layout";
import { authRoutes } from "./routes/auth";
import { postMeta, postRoutes } from "./routes/post";
import { writeRoutes } from "./routes/write";

const app = new Hono<AppEnv>();

// Registered before csrf() on purpose. A csrf rejection throws without calling
// next(), so anything registered after it never runs and its response would go out
// bare. Sitting outside means this wraps the rejection too.
//
// Every page the Worker renders is either per-account or shows the viewer's handle,
// and the signup page prints the account number itself. None of it may be stored by
// a browser or a shared cache. Static assets bypass the Worker and keep their own headers.
app.use(async (c, next) => {
  await next();
  c.header("Cache-Control", "private, no-store");
  c.header("Referrer-Policy", "same-origin");
  c.header("X-Content-Type-Options", "nosniff");
  // Nothing here should ever be framed. Stops a third-party page from overlaying
  // a decoy on the challenge widget or the logout button.
  c.header("X-Frame-Options", "DENY");
});

// Rejects form POSTs whose Origin (or Sec-Fetch-Site) is not this site. Browsers always send one.
app.use(csrf());
app.use(sessionMiddleware);

app.get("/", async (c) => {
  // Newest first, hidden excluded. Pagination, handle pages and tag pages are phase 6.
  const { results } = await c.env.DB.prepare(
    "SELECT posts.id AS id, posts.body AS body, posts.created_at AS created_at, " +
      "users.handle AS handle FROM posts JOIN users ON users.id = posts.user_id " +
      "WHERE posts.hidden = 0 ORDER BY posts.created_at DESC, posts.rowid DESC LIMIT 50",
  ).all<{ id: string; body: string; created_at: number; handle: string }>();

  const { results: tagRows } = await c.env.DB.prepare(
    "SELECT post_id, tag FROM tags ORDER BY tag",
  ).all<{ post_id: string; tag: string }>();
  const tagsByPost = new Map<string, string[]>();
  for (const row of tagRows) {
    const list = tagsByPost.get(row.post_id) ?? [];
    list.push(row.tag);
    tagsByPost.set(row.post_id, list);
  }

  return c.html(
    page({
      title: "pour",
      user: c.get("user"),
      body: results.length
        ? html`<ul class="timeline">
            ${results.map(
              (post) => html`<li>
                ${postMeta(post, tagsByPost.get(post.id) ?? [])}
                <p class="excerpt"><a href="/p/${post.id}">${excerpt(post.body)}</a></p>
              </li>`,
            )}
          </ul>`
        : html`<p class="note">Nothing here yet. Be the first to write something.</p>`,
    }),
  );
});

/**
 * A plain-text opening for the timeline. Strips the common markdown marks so the
 * excerpt reads as prose rather than as source. The result is interpolated through
 * the escaping template like any other text, so it is not a sanitiser and does not
 * need to be one.
 */
export function excerpt(body: string, limit = 180): string {
  const flat = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>)\s*/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/^\s{0,3}\d+\.\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > limit ? `${flat.slice(0, limit).trimEnd()}\u2026` : flat;
}

app.get("/health", (c) => c.text("ok"));

app.route("/", authRoutes);
app.route("/", writeRoutes);
app.route("/", postRoutes);

export default app;
