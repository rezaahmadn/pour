import { Hono } from "hono";
import { html } from "hono/html";
import { bodyLimit } from "hono/body-limit";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv, User } from "../env";
import { nowSec } from "../crypto";
import {
  GENESIS_HASH,
  MAX_BODY_BYTES,
  MAX_TAGS,
  computeHash,
  isUniqueViolation,
  normalizeBody,
  parseTags,
} from "../post";
import { requireAuth } from "../auth";
import { page } from "../layout";

/** From the PRD's abuse controls. */
export const MIN_ACCOUNT_AGE_SEC = 10 * 60;
export const POSTS_PER_MINUTE = 1;
export const POSTS_PER_DAY = 50;
/** Retries when another publish claimed the same parent first. */
export const CHAIN_ATTEMPTS = 5;

function editor(
  user: User,
  error: string | null,
  body = "",
  tags = "",
  saved: ServerDraft | null = null,
) {
  return html`<h1>write</h1>
    ${error ? html`<p class="error">${error}</p>` : ""}
    <form
      method="post"
      action="/write"
      data-autosave
      data-sync-ms="${DRAFT_SYNC_MS}"
      data-saved-body="${saved?.body ?? ""}"
      data-saved-tags="${saved?.tags ?? ""}"
      data-saved-at="${saved ? String(saved.updated_at * 1000) : ""}"
    >
      <label>
        your post
        <textarea name="body" rows="14" required autofocus>${body}</textarea>
      </label>
      <label>
        tags, comma separated, up to ${MAX_TAGS}
        <input name="tags" autocapitalize="none" autocomplete="off" value="${tags}" />
      </label>
      <button type="submit">Publish</button>
    </form>
    <p class="note"><span id="draft-status"></span></p>
    <p class="note">
      Markdown works. Publishing is permanent: @${user.handle} cannot edit or delete this later.
    </p>`;
}

/** Draft autosave. Only the editor loads it; every other page stays script free. */
const editorHead = html`<script src="/editor.js" defer></script>`;

/** A draft body can be as long as a post, so this matches the publish limit. */
const draftLimit = bodyLimit({
  maxSize: MAX_BODY_BYTES + 64 * 1024,
  onError: (c) => c.text("Draft too large", 413),
});

export type ServerDraft = { body: string; tags: string; updated_at: number };

/** How often the editor pushes a copy to the server, per the PRD. */
export const DRAFT_SYNC_MS = 5000;

export const writeRoutes = new Hono<AppEnv>();

writeRoutes.get("/write", requireAuth, async (c) => {
  const user = c.get("user")!;
  // Handed to the page rather than fetched by script, so the editor has both
  // copies before the first paint and never briefly shows the wrong one.
  const saved = await c.env.DB.prepare(
    "SELECT body, tags, updated_at FROM drafts WHERE user_id = ?",
  )
    .bind(user.id)
    .first<ServerDraft>();
  return c.html(
    page({ title: "write", user, head: editorHead, body: editor(user, null, "", "", saved) }),
  );
});

/**
 * The editor pushes a copy here on a timer so a draft begun on a phone can be
 * picked up on a laptop. Last write wins, which is the right rule when both
 * copies belong to the same person: the newer keystroke is the one they meant.
 */
writeRoutes.post("/draft", requireAuth, draftLimit, async (c) => {
  const user = c.get("user")!;
  const form = await c.req.parseBody();
  const body = typeof form.body === "string" ? form.body : "";
  const tags = typeof form.tags === "string" ? form.tags : "";
  const now = nowSec();

  if (!body.trim()) {
    await c.env.DB.prepare("DELETE FROM drafts WHERE user_id = ?").bind(user.id).run();
    return c.json({ cleared: true, updatedAt: null });
  }
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
    return c.json({ error: "too long" }, 400);
  }
  await c.env.DB.prepare(
    "INSERT INTO drafts (user_id, body, tags, updated_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET body = excluded.body, tags = excluded.tags, " +
      "updated_at = excluded.updated_at",
  )
    .bind(user.id, body, tags, now)
    .run();
  return c.json({ cleared: false, updatedAt: now * 1000 });
});

writeRoutes.post(
  "/write",
  requireAuth,
  // Generous next to the form fields elsewhere, because a post body has no length
  // limit by policy. The byte cap below is what actually bounds it.
  bodyLimit({ maxSize: MAX_BODY_BYTES + 64 * 1024, onError: (c) => c.text("Post too large", 413) }),
  async (c) => {
    const user = c.get("user")!;
    const form = await c.req.parseBody();
    const rawBody = typeof form.body === "string" ? form.body : "";
    const rawTags = typeof form.tags === "string" ? form.tags : "";
    const fail = (status: ContentfulStatusCode, message: string) =>
      c.html(
        page({
          title: "write",
          user,
          head: editorHead,
          body: editor(user, message, rawBody, rawTags, null),
        }),
        status,
      );

    const parsedBody = normalizeBody(rawBody);
    if ("error" in parsedBody) return fail(400, parsedBody.error);
    const parsedTags = parseTags(rawTags);
    if ("error" in parsedTags) return fail(400, parsedTags.error);

    const now = nowSec();
    const account = await c.env.DB.prepare("SELECT created_at, frozen FROM users WHERE id = ?")
      .bind(user.id)
      .first<{ created_at: number; frozen: number }>();
    if (!account) return fail(403, "That account no longer exists.");
    if (account.frozen) return fail(403, "This account cannot publish.");
    if (now - account.created_at < MIN_ACCOUNT_AGE_SEC) {
      const wait = Math.ceil((MIN_ACCOUNT_AGE_SEC - (now - account.created_at)) / 60);
      return fail(429, `New accounts wait ${wait} more minute${wait === 1 ? "" : "s"} before posting.`);
    }

    const counts = await c.env.DB.prepare(
      "SELECT " +
        "SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS recent, " +
        "SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS today " +
        "FROM posts WHERE user_id = ?",
    )
      .bind(now - 60, now - 24 * 60 * 60, user.id)
      .first<{ recent: number | null; today: number | null }>();
    if ((counts?.recent ?? 0) >= POSTS_PER_MINUTE) {
      return fail(429, "One post a minute. Give it a moment.");
    }
    if ((counts?.today ?? 0) >= POSTS_PER_DAY) {
      return fail(429, `That is ${POSTS_PER_DAY} posts today. Come back tomorrow.`);
    }

    // Append to the chain. The unique index on prev_hash means a publish that
    // raced another one simply fails to insert, so it re-reads the head and tries
    // again rather than creating a second branch.
    for (let attempt = 0; attempt < CHAIN_ATTEMPTS; attempt++) {
      const head = await c.env.DB.prepare("SELECT hash FROM posts ORDER BY rowid DESC LIMIT 1")
        .first<{ hash: string }>();
      const prevHash = head?.hash ?? GENESIS_HASH;
      const id = crypto.randomUUID();
      const createdAt = nowSec();
      const hash = await computeHash(prevHash, user.id, parsedBody.body, createdAt);
      try {
        await c.env.DB.batch([
          c.env.DB.prepare(
            "INSERT INTO posts (id, user_id, body, created_at, prev_hash, hash, hidden) " +
              "VALUES (?, ?, ?, ?, ?, ?, 0)",
          ).bind(id, user.id, parsedBody.body, createdAt, prevHash, hash),
          ...parsedTags.tags.map((tag) =>
            c.env.DB.prepare("INSERT INTO tags (post_id, tag) VALUES (?, ?)").bind(id, tag),
          ),
        ]);
        await c.env.DB.prepare("DELETE FROM drafts WHERE user_id = ?").bind(user.id).run();
        return c.redirect(`/p/${id}`);
      } catch (err) {
        // Someone else took this parent. Anything else is a real failure.
        if (!isUniqueViolation(err, "posts.prev_hash")) throw err;
      }
    }
    return fail(503, "The timeline is busy right now. Try publishing again.");
  },
);
