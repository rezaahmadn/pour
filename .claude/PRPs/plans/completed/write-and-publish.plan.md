# Plan: Write and Publish

Phase 3 of the pour PRD. Turns the `/write` stub into a real editor and makes the ledger real.

## Summary

A logged-in user writes a markdown post with free tags and publishes it. The post is rendered safely, appended to a tamper-evident hash chain, and shown at its own URL and on the timeline. Nothing can edit or delete it.

## User Story

As someone with a thought worth keeping, I want to type it and hit publish, so that it is permanently on the record before the moment passes.

## Metadata

- **Source PRD**: `.claude/PRPs/prds/pour.prd.md`, phase 3
- **Depends on**: phase 2, complete
- **Success signal from the PRD**: two rapid publishes produce a valid chain, and no edit or delete route exists

---

## The two decisions that shape everything

### Markdown: micromark, no sanitizer

`allowDangerousHtml` and `allowDangerousProtocol` both default to false. Raw HTML in a post is escaped to text rather than emitted as elements, and `javascript:` or `data:` URLs in links are dropped. Link protocols are limited to http, https, irc, ircs, mailto, xmpp; images to http and https.

That removes the need for a separate sanitizer, which is the usual source of XSS in this shape of app. It is also by far the smallest option: 210 KB unpacked against 483 KB for marked and 1.9 MB for markdown-it, which matters because Worker startup is currently 9 ms.

Never pass either dangerous option. There is a test asserting a script tag in a post body comes out escaped.

### Hash chain: let the database forbid forks

The PRD specifies `hash = sha256(prev_hash || user_id || body || created_at)` inserted in a batch that reads the head and writes the row. That cannot be atomic as written: SQLite has no sha256, so the hash must be computed in JavaScript, which makes it read-then-write, which is the same race that produced two defects in phase 2.

Instead, make a fork unstorable. `posts.prev_hash` gets a UNIQUE index, so any given hash can be the parent of at most one post. Publishing then becomes:

1. Read the head: `SELECT hash FROM posts ORDER BY rowid DESC LIMIT 1`, falling back to the genesis constant.
2. Compute the new hash in JS.
3. Insert. If two publishes raced, one hits the UNIQUE constraint on `prev_hash` and loses.
4. The loser retries from step 1, bounded at a few attempts.

Ordering uses `rowid`, which SQLite assigns monotonically. Posts are never deleted, so rowids are never reused.

Genesis is 64 zeros, so the first post's parent is a fixed known value.

---

## Scope

Building:

- `GET /write`: textarea, tags field, publish button. Replaces the stub.
- `POST /write`: validate, rate limit, compute hash, insert post and tags, redirect to the post.
- `GET /p/:id`: the post page, rendered markdown, author, timestamp, tags.
- Markdown rendering through micromark.
- Free tag parsing, comma separated, normalized like handles.
- Posting limits from the PRD: one post per minute per account, fifty per day, and no posting from an account under ten minutes old.
- A simple newest-first list on `/` so publishing is visible.

Not building, these belong to later phases:

- Pagination, `/@handle`, `/tag/:tag`, RSS. Phase 6.
- The `/verify` endpoint and admin hide. Phase 7. The `hidden` column is respected by every read query here, but nothing sets it yet.
- Local draft autosave. Phase 5.
- Images. Phase 9.
- Any edit or delete path, ever.

---

## Tasks

### 1. Dependency and migration

Install micromark. Add `migrations/0004_chain_integrity.sql` creating a unique index on `posts.prev_hash`, with a comment explaining that it is what makes a fork unstorable rather than merely detectable.

### 2. `src/markdown.ts`

Wrap micromark in one function, `renderMarkdown(body: string): string`, with the safe defaults left untouched and a comment saying why they must stay untouched.

### 3. `src/post.ts`

- `GENESIS_HASH`, 64 zeros.
- `MAX_BODY_BYTES`, 1 MB, matching the PRD's D1 row safety limit.
- `computeHash(prevHash, userId, body, createdAt)` built on the existing helpers in `src/crypto.ts`.
- `parseTags(input)`: split on commas, normalize each to lowercase, drop empties and duplicates, cap the count and length. Reuse the handle character rules.
- `normalizeBody(input)`: trim trailing whitespace, reject empty, reject over the byte cap.

### 4. `src/routes/write.ts`

`GET /write` renders the editor. `POST /write` does, in order: auth, body and tag validation, the three posting limits, then the guarded insert with retry. Tags go into the same batch as the post so a post can never exist without its tags.

Account age and post counts come from `users.created_at` and the `posts` table, no new tables.

### 5. `src/routes/post.ts`

`GET /p/:id` renders one post, or 404 when it is missing or hidden.

### 6. Timeline

`/` lists posts newest first, excluding hidden, with author, timestamp and a link to each post.

### 7. Styling

Editor textarea, post body typography, tag chips, and the timeline list, using the tokens already in `public/style.css`.

### 8. Tests

Covering at minimum:

- Publishing produces a post reachable at its URL.
- Raw HTML in a body is escaped, and a `javascript:` link is dropped.
- The chain: first post's parent is genesis, each subsequent parent is the previous hash.
- Concurrent publishes produce a valid chain with no fork, asserted by walking it.
- The three posting limits each reject.
- A body over the cap is rejected.
- Hidden posts are absent from the timeline and return 404.
- No route accepts a method that would edit or delete a post.

---

## Validation

`npm run types`, `npm run check`, `npm test`, then a real browser publish against `wrangler dev`, then production.

The chain check that matters: publish several posts concurrently, then walk from genesis and confirm every post is reachable exactly once.
