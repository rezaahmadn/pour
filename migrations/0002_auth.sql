-- Signup throttling: one row per successful signup, keyed by HMAC of the client IP.
-- Rows older than a day are ignored by the query; nothing deletes them in v1.
CREATE TABLE signups (
  ip_hmac TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX signups_ip_hmac ON signups(ip_hmac, created_at);

-- Login lockout: failed attempts per HMAC of the submitted number. Row deleted on success.
CREATE TABLE login_failures (
  number_hmac TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);
