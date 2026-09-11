-- Images belonging to posts.
--
-- A row is created at upload time, while the post is still being written, so
-- post_id starts null and is claimed when the writer publishes. Unclaimed rows
-- are a half-finished thought someone abandoned; nothing reads them.
--
-- sha256 is folded into the post's hash at publish time, so the ledger covers
-- the pictures as well as the words.
CREATE TABLE images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  post_id TEXT REFERENCES posts(id),
  r2_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX images_post_id ON images(post_id);
CREATE INDEX images_user_pending ON images(user_id, post_id, created_at);
