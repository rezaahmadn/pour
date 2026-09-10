-- Makes a forked chain impossible to store, rather than merely detectable later.
--
-- The post hash is sha256 over the previous hash and the post's own fields.
-- SQLite cannot compute sha256, so the hash has to be built in the Worker, which
-- makes "read the head, then insert" a race: two publishes landing together would
-- both read the same head and both chain off it. A unique parent means the second
-- one cannot be written at all. The loser retries against the new head.
CREATE UNIQUE INDEX posts_prev_hash ON posts(prev_hash);
