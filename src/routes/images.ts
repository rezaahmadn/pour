import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../env";
import { nowSec } from "../crypto";
import { MAX_IMAGE_BYTES, MAX_IMAGES_PER_POST, checkImage, imageKey } from "../images";
import { requireAuth } from "../auth";

export const imageRoutes = new Hono<AppEnv>();

const uploadLimit = bodyLimit({
  maxSize: MAX_IMAGE_BYTES + 64 * 1024,
  onError: (c) => c.json({ error: "That image is too large." }, 413),
});

/**
 * Takes a picture the browser has already resized and re-encoded. The row is
 * created without a post, because the post does not exist yet; publishing claims
 * whatever this writer has uploaded and not yet used.
 */
imageRoutes.post("/upload", requireAuth, uploadLimit, async (c) => {
  const user = c.get("user")!;
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) return c.json({ error: "No image was sent." }, 400);

  const pending = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM images WHERE user_id = ? AND post_id IS NULL",
  )
    .bind(user.id)
    .first<{ n: number }>();
  if ((pending?.n ?? 0) >= MAX_IMAGES_PER_POST) {
    return c.json({ error: `Up to ${MAX_IMAGES_PER_POST} images on a post.` }, 429);
  }

  const checked = await checkImage(file);
  if (!checked.ok) return c.json({ error: checked.error }, 400);

  const key = imageKey(file.type);
  await c.env.IMAGES.put(key, checked.bytes as unknown as ArrayBuffer, {
    httpMetadata: { contentType: file.type },
  });
  await c.env.DB.prepare(
    "INSERT INTO images (id, user_id, post_id, r2_key, sha256, bytes, content_type, created_at) " +
      "VALUES (?, ?, NULL, ?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      user.id,
      key,
      checked.sha256,
      checked.bytes.byteLength,
      file.type,
      nowSec(),
    )
    .run();

  return c.json({ url: `/i/${key}`, markdown: `![](/i/${key})` }, 201);
});

/**
 * Serves a picture from R2. An image belonging to a hidden post is withheld the
 * same way the post itself is, otherwise hiding a post would leave its pictures
 * reachable by anyone holding the link.
 */
imageRoutes.get("/i/:key", async (c) => {
  const key = c.req.param("key");
  const row = await c.env.DB.prepare(
    "SELECT images.content_type AS content_type, " +
      "COALESCE(posts.hidden, 0) AS hidden, images.post_id AS post_id " +
      "FROM images LEFT JOIN posts ON posts.id = images.post_id WHERE images.r2_key = ?",
  )
    .bind(key)
    .first<{ content_type: string; hidden: number; post_id: string | null }>();
  if (!row || row.hidden) return c.notFound();

  const object = await c.env.IMAGES.get(key);
  if (!object) return c.notFound();

  // The key is random and the bytes never change, so this can be cached hard.
  // Overriding Cache-Control is why the header middleware defers to routes.
  c.header("Content-Type", row.content_type);
  c.header("Cache-Control", "public, max-age=31536000, immutable");
  c.header("ETag", object.httpEtag);
  return c.body(object.body as unknown as ReadableStream);
});
