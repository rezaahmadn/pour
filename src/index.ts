import { Hono } from "hono";
import { html } from "hono/html";
import { csrf } from "hono/csrf";
import type { AppEnv } from "./env";
import { sessionMiddleware } from "./auth";
import { page } from "./layout";
import { authRoutes } from "./routes/auth";
import { excerptOf } from "./post";
import { adminRoutes } from "./routes/admin";
import { formatDate, postMeta, postRoutes } from "./routes/post";
import { verifyRoutes } from "./routes/verify";
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
    // A hidden entry stays on the timeline as a placeholder so the record reads as
    // continuous, but the blanking happens in SQL: its body and author never reach
    // the template at all, so no rendering mistake can leak them.
    "SELECT posts.id AS id, posts.created_at AS created_at, posts.hidden AS hidden, " +
      "posts.hash AS hash, " +
      "CASE WHEN posts.hidden = 1 THEN '' ELSE posts.body END AS body, " +
      "CASE WHEN posts.hidden = 1 THEN '' ELSE users.handle END AS handle " +
      "FROM posts JOIN users ON users.id = posts.user_id " +
      "ORDER BY posts.created_at DESC, posts.rowid DESC LIMIT 50",
  ).all<{
    id: string;
    body: string;
    created_at: number;
    handle: string;
    hidden: number;
    hash: string;
  }>();

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
              (post) =>
                post.hidden
                  ? html`<li class="hidden-entry">
                      <p class="meta">
                        <a href="/p/${post.id}">${formatDate(post.created_at)}</a>
                        <span class="flag">entry hidden</span>
                      </p>
                      <p class="excerpt">
                        This entry was hidden. Its hash stays in the chain:
                        <code>${post.hash.slice(0, 16)}\u2026</code>
                      </p>
                    </li>`
                  : html`<li>
                      ${postMeta(post, tagsByPost.get(post.id) ?? [])}
                      <p class="excerpt"><a href="/p/${post.id}">${excerptOf(post.body)}</a></p>
                    </li>`,
            )}
          </ul>`
        : html`<p class="note">Nothing here yet. Be the first to write something.</p>`,
    }),
  );
});

app.get("/health", (c) => c.text("ok"));

app.route("/", authRoutes);
app.route("/", writeRoutes);
app.route("/", postRoutes);
app.route("/", verifyRoutes);
app.route("/", adminRoutes);

export default app;
