-- Append-only ledger. No UPDATE/DELETE on posts except the hidden flag (admin).
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE,
  number_hmac TEXT NOT NULL UNIQUE,
  frozen INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX posts_created_at ON posts(created_at DESC);
CREATE INDEX posts_user_id ON posts(user_id, created_at DESC);

CREATE TABLE tags (
  post_id TEXT NOT NULL REFERENCES posts(id),
  tag TEXT NOT NULL,
  PRIMARY KEY (post_id, tag)
);
CREATE INDEX tags_tag ON tags(tag);

CREATE TABLE drafts (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  body TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
