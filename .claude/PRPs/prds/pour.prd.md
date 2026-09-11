# pour

## Problem Statement

Reza wants to write a lot, in public, from a phone, without friction. Native journaling apps (Repov, Day One) start slowly on mobile and lock writing behind app launches and accounts. Minimal blog platforms (Bear, Mataroa) are fast but are single-author silos with generic looks. Nothing combines "open a URL and write in seconds", anonymous account creation, and a shared public timeline. The cost of not solving it: writing keeps not happening.

## Evidence

- User statement: "slow start up on mobile, so I want to make a quick one using webapp."
- User statement: success is "if I kept using it for a month." Current tools have not achieved that.
- Assumption - needs validation: strangers will also sign up and post once the site exists. No evidence yet; single-user use is the only validated need.

## Proposed Solution

A server-rendered web app on Cloudflare Workers with a D1 database. Anyone can create an account by receiving a randomly generated 16-digit account number (Mullvad-style) and choosing a username. No email, no password. Users write markdown posts with free tags. Every published post is appended to a single global timeline and to a tamper-evident hash chain. Posts cannot be edited or deleted; an admin can hide a post from view but the record remains. The editor autosaves drafts locally so a refresh or backgrounded phone tab never loses text. Design follows Bear Blog: text-first, near-zero JavaScript, fast.

Chosen over: Solana or other chains (per-post cost, wallet-based identity, cannot remove illegal content); Supabase (free tier pauses after 7 idle days); an off-the-shelf platform (no account-number login, no shared ledger).

## Key Hypothesis

We believe a frictionless anonymous signup and a permanent shared public timeline will make Reza write far more often.
We'll know we're right when Reza publishes 20 or more posts in the first 30 days and the site is still in use at day 30.

## What We're NOT Building

- Comments, likes, follows, DMs - social mechanics pull toward engagement metrics, not writing.
- Edit or delete of published posts - the timeline is a ledger; permanence is the point.
- Search (v1) - tags and handle pages cover navigation for now.
- Blockchain storage - see Decisions Log.
- Email or password auth - the account number is the only credential.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Posts by Reza in first 30 days | 20+ | `SELECT COUNT(*) FROM posts WHERE user_id = ?` |
| Days with at least one post (first 30 days) | 12+ | Same table, grouped by date |
| Time from URL open to editor ready on mobile | Under 1 s on 4G | Lighthouse / WebPageTest |
| Draft loss incidents | 0 | Reza reports |
| Monthly hosting cost | $0 | Cloudflare billing |

## Open Questions

- [x] Post length cap: none, matching Mataroa. Hard stop at 1 MB per body for D1 safety.
- [x] Images: yes, via R2. See Solution Detail and Decisions Log.
- [x] Spam plan: decided now. See Spam and Abuse section.
- [x] Name: "pour" stays as project name and subdomain.
- [x] Recovery: none in v1. Optional recovery email as a later Could item; number stays the only login credential.
- [x] Account numbers: 16 digits.

---

## Users & Context

**Primary User**
- **Who**: Reza, writing personal thoughts and journal entries in public.
- **Current behavior**: Tries native journaling apps, gets slowed by app start-up on phone, writes less than wanted.
- **Trigger**: A thought worth keeping, usually on phone, often with interruptions (minimize, switch app, accidental refresh).
- **Success state**: Text is published to the timeline within a minute of the thought, and nothing written was lost along the way.

**Secondary User**
- **Who**: Strangers who find the timeline and want to post anonymously.
- **Current behavior**: Read only, or use platforms that demand email and identity.
- **Trigger**: Seeing a public timeline that requires nothing but a generated number.

**Job to Be Done**
When a thought is worth keeping, I want to open a URL and write immediately, so I can publish it before the moment passes and never lose it.

**Non-Users**
- People who want an audience-building tool with analytics, newsletters, or SEO features.
- People who need private journaling. Everything here is public.
- People who need to edit or delete after publishing.

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | Account-number signup and login (generated 16-digit number + chosen username) | Zero-friction anonymous identity; the distinctive feature |
| Must | Write and publish markdown post | The core action |
| Must | Local autosave of draft (localStorage, restore on load, clear on publish) | Mobile interruptions are the stated pain |
| Must | Global timeline, newest first, paginated | The shared ledger |
| Must | Append-only hash chain on posts; no UPDATE/DELETE path in code | Ledger guarantee |
| Must | Admin hide flag (content stays, visibility off) | Legal safety for a host of anonymous content |
| Should | Free tags on posts and `/tag/:tag` pages | Organization; user likes Repov's categories |
| Should | `/@handle` author pages | Timeline "just like Repov" per person |
| Should | Server-side draft sync (one draft row per user) | Cross-device continuation |
| Should | RSS feed for timeline, handle, and tag | Bear-style openness; cheap |
| Should | Image upload to R2 (client-side resize and re-encode, EXIF stripped) | User wants images; Repov-style entries |
| Must | Spam and abuse controls (Turnstile on signup, rate limits, account freeze) | Anonymous open signup is otherwise a spam magnet |
| Could | Public chain verification endpoint (`/verify`) | Lets anyone confirm integrity |
| Could | Passkey (WebAuthn) as optional second login method | Better UX; number remains fallback |
| Could | Optional recovery email (opt-in, hashed, only used to re-issue a number) | User asked for it later; must stay optional to keep anonymous default |
| Could | Dark mode via `prefers-color-scheme` | Small CSS cost |
| Could | Daily anchor of latest chain hash to an external system | External proof; only if cheap and simple |
| Won't | Comments, likes, follows, DMs | Out of scope by decision |
| Won't | Edit or delete published posts | Ledger |
| Won't | Search (v1) | Deferred |

### MVP Scope

Signup with generated number and handle, login, write a markdown post with tags, local autosave, global timeline, hash chain, admin hide. Deployed at a free `*.workers.dev` or `*.pages.dev` subdomain. Bear-inspired CSS with one accent color and system or one self-hosted font.

### User Flow

1. Open URL. Timeline renders server-side in one request.
2. Tap "write". If not logged in, see "Get an account number" and "I have a number" side by side.
3. "Get a number": server generates 16 random digits, user picks a handle, number is shown once with copy and download buttons and a warning that it cannot be recovered. Session cookie set.
4. Editor: single textarea plus tags field. Every keystroke autosaves to localStorage. Refresh or backgrounding restores it.
5. Publish: server inserts post, computes hash from previous hash, redirects to the post. Local draft cleared.
6. Post appears at top of timeline, on `/@handle`, and on each `/tag/:tag`.

### Spam and Abuse

Decided up front because signup is open and anonymous.

- **Signup**: Cloudflare Turnstile (free, invisible for most humans) on the "get a number" form. Per-IP cap of 3 signups per day enforced in D1.
- **Posting**: per-account limit of 1 post per minute and 50 per day. Accounts younger than 10 minutes cannot post.
- **Login**: throttled per client, not per account number. A brute-force attempt submits a different number every time, so a per-number counter would never fire and would store one row per guess.
  - Workers rate-limit binding: 10 attempts per minute per client IP.
  - 5 failed attempts lock the client for 15 minutes. Each further run of 5 doubles the lock, up to 24 hours. The counter is incremented inside SQL so attempts arriving together cannot overwrite each other.
  - Once a client has any failure on record, every further attempt must solve a Turnstile challenge. The first attempt is deliberately unchallenged: an account has no recovery path, so a blocked or broken widget must never be the only thing standing between someone and their own account.
  - A malformed number is a typo, not a guess, and does not consume an attempt.
- **Admin**: hide any post (record stays, hash stays). Freeze any account (cannot post, existing posts remain). Freeze is the "ban"; nothing is deleted.
- **Images**: same hide and freeze rules. Hidden post hides its images.
- **Escape hatch**: `SIGNUP_OPEN` env flag. If spam wins, flip to closed and require an invite code. No code change.

### Images

- Upload from the editor. Browser resizes to max 2000 px on the long edge and re-encodes to WebP or JPEG with a canvas before upload. This strips EXIF, including GPS, which matters for anonymous users, and keeps files small.
- Server accepts only re-encoded image types, caps at 5 MB, stores in R2 under a random key, and records `(post_id, key, sha256)` in an `images` table.
- Image hashes are included in the post hash so the ledger covers them.
- Served through the Worker from the R2 binding with long cache headers. R2 free tier: 10 GB storage, zero egress.

---

## Technical Approach

**Feasibility**: HIGH

**Architecture Notes**
- Single Cloudflare Worker using Hono. Server-rendered HTML with `hono/html`. Static CSS and a small editor script served through the Workers static assets binding.
- D1 (SQLite) via raw prepared statements (`c.env.DB.prepare(sql).bind(...)`). No ORM. Drizzle was in the first draft and dropped at scaffold time: the query surface is small and one fewer dependency keeps the free-tier CPU budget. Always go through `c.env.DB` inside a handler, never a module-level singleton.
- Tables: `users(id, handle, number_hmac, created_at)`, `sessions(id, user_id, expires_at)`, `posts(id, user_id, body, created_at, prev_hash, hash, hidden)`, `tags(post_id, tag)`, `drafts(user_id, body, tags, updated_at)`.
- Hash chain: `hash = sha256(prev_hash || user_id || body || created_at)`. Insert happens inside a single D1 batch that reads the latest hash and writes the new row, to avoid forks under concurrent publishes.
- Account numbers: generated with `crypto.getRandomValues`, stored as HMAC-SHA256 with a secret pepper from Worker env. Slow hashing is unnecessary because the credential is high-entropy, and it would exceed the 10 ms free-tier CPU limit.
- Post body: no cap by policy (matching Mataroa); server rejects bodies over 1 MB to stay inside D1 row limits.
- Sessions: random 32-byte id in D1, HttpOnly Secure SameSite=Lax cookie, 30-day expiry.
- Rate limiting on login and signup: Workers Rate Limiting bindings (`ratelimits` in `wrangler.jsonc`, GA since 2025-09, no dashboard rule needed), plus per-number lockout stored in D1 after repeated failures, plus a per-IP signup cap stored in D1.
- No edit/delete routes exist. The D1 access pattern uses INSERT and SELECT only for `posts`; the only UPDATE is `hidden` on the admin path.
- Admin: a single handle listed in Worker env is treated as admin.
- Open source: all secrets (HMAC pepper, Turnstile secret, admin handle) are Worker secrets set via `wrangler secret put`. `.dev.vars` is gitignored. Nothing security-relevant depends on the code being private.

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Free Workers 10 ms CPU limit on auth paths | M | HMAC instead of Argon2/bcrypt; measure with `wrangler dev` |
| Hash chain fork from concurrent publishes | L | Single D1 batch per publish; verify endpoint detects forks |
| Spam once public | M | Turnstile, per-IP signup cap, per-account post limits, freeze; `SIGNUP_OPEN` flag as escape hatch |
| EXIF or GPS leak from anonymous users' photos | M | Client-side canvas re-encode strips metadata; server rejects non-re-encoded uploads |
| R2 abuse via large or many uploads | L | 5 MB cap, 10 images per post, counted against daily post limit |
| Lost account number, angry user | M | Show once, copy and download buttons, explicit warning; document "no recovery" on signup page |
| iOS Safari drops localStorage in private mode | L | Feature-detect, fall back to in-memory with a visible warning |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently (e.g., "with 3" or "-")
  DEPENDS: phases that must complete first (e.g., "1, 2" or "-")
  PRP: link to generated plan file once created
-->

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | Scaffold and deploy | Hono + D1 worker, schema, CI deploy to workers.dev, hello-world timeline | complete | - | - | shipped in commit e1e4666, live at https://pour.rezaahmadn.workers.dev |
| 2 | Account-number auth | Generate number, handle, HMAC storage, sessions, login/logout, Turnstile, rate limits | complete | - | 1 | `.claude/PRPs/plans/completed/account-number-auth.plan.md` |
| 3 | Write and publish | Editor page, markdown render, tags, hash-chain insert, post page | complete | with 4 | 2 | `.claude/PRPs/plans/completed/write-and-publish.plan.md` |
| 4 | Design system | Bear-inspired CSS, typography, layout, dark mode, mobile-first | partial | with 3 | 1 | Palette, spacing scale, dark mode, forms and layout shell shipped in commit 00db4f0. Editor styling and the Lighthouse pass remain |
| 5 | Autosave | localStorage draft with restore, flush on visibilitychange/pagehide, clear on publish | complete | - | 3 | Verified in a browser: type, kill the tab, reopen, restore |
| 6 | Timeline views | Global paginated timeline, `/@handle`, `/tag/:tag`, RSS | complete | with 7 | 3, 4 | One query per view; cursor paging on rowid rather than offset |
| 7 | Admin and ledger | Hide flag, account freeze, admin route, `/verify` chain endpoint | complete | with 6 | 3 | Hidden entries stay on the timeline as placeholders so the record reads as continuous |
| 9 | Images | R2 bucket, client-side resize and re-encode, upload route, image hashes in chain | pending | - | 3, 7 | - |
| 8 | Server drafts and polish | Drafts table sync, passkey (optional), `SIGNUP_OPEN` flag | pending | with 9 | 5, 6, 7 | - |

### Phase Details

**Phase 1: Scaffold and deploy**
- **Goal**: A deployed URL that renders a server-side page from D1.
- **Scope**: `wrangler` project, Hono app, Drizzle schema and migrations, GitHub Actions deploy, static assets binding.
- **Success signal**: `https://pour.<account>.workers.dev` returns a page listing rows from D1.

**Phase 2: Account-number auth**
- **Goal**: Anyone can get a number, pick a handle, and log in.
- **Scope**: Number generation, HMAC with pepper, `users` and `sessions` tables, cookie middleware, login/logout, Turnstile on signup, per-IP signup cap, lockout and rate limiting.
- **Success signal**: Signup shows number once; login with it works; wrong number fails and locks after N tries.

**Phase 3: Write and publish**
- **Goal**: Logged-in user publishes a markdown post that enters the hash chain.
- **Scope**: Editor route, markdown rendering (sanitized), tags parsing, batched insert with hash computation, post page.
- **Success signal**: Two rapid publishes produce a valid chain; no edit/delete route exists.

**Phase 4: Design system**
- **Goal**: Bear-like but with its own identity: one accent color, careful typography, generous whitespace, mobile-first.
- **Scope**: Single CSS file, layout shell, editor styling, dark mode.
- **Success signal**: Lighthouse performance and accessibility both above 95 on mobile.

**Phase 5: Autosave**
- **Goal**: No text lost on refresh, tab discard, or backgrounding.
- **Scope**: Debounced localStorage write, restore banner, flush on `visibilitychange` and `pagehide`, clear on confirmed publish.
- **Success signal**: Type on phone, kill the tab, reopen, text is there.

**Phase 6: Timeline views**
- **Goal**: Public reading surfaces.
- **Scope**: Paginated global timeline, `/@handle`, `/tag/:tag`, RSS for each.
- **Success signal**: All three views render in one D1 query each and hidden posts are excluded.

**Phase 7: Admin and ledger**
- **Goal**: Safety and verifiability.
- **Scope**: Admin-only hide toggle, account freeze, `/verify` endpoint that walks the chain, hidden placeholder in timeline.
- **Success signal**: Hidden post shows as "entry hidden" with hash intact; `/verify` reports OK.

**Phase 8: Server drafts and polish**
- **Goal**: Cross-device drafts and gated public opening.
- **Scope**: `drafts` upsert every 5 s, conflict rule by timestamp, `SIGNUP_OPEN` env flag with invite code, optional passkey.
- **Success signal**: Draft started on phone appears on laptop; signup closed unless flag set.

**Phase 9: Images**
- **Goal**: Posts can carry images without leaking metadata or costing money.
- **Scope**: R2 bucket binding, editor upload with canvas re-encode, upload route with type and size checks, `images` table, image hashes folded into post hash, serving route with cache headers.
- **Success signal**: Photo taken on phone uploads under 500 KB with no EXIF; hidden post returns 404 for its images.

### Parallelism Notes

Phases 3 and 4 can run together after auth exists: one builds routes and data, the other builds CSS against static markup. Phases 6 and 7 are independent read paths on the same `posts` table. Phase 5 depends on the editor from phase 3. Phases 8 and 9 can run together at the tail.

---

## Executor Notes

Conventions every implementation plan for this repo follows. Written so a smaller model can execute a plan without judgment calls.

- **Stack facts**: Hono 4 on Workers, TypeScript strict, raw D1 (`c.env.DB.prepare`), HTML via `html` tagged template from `hono/html`, one CSS file in `public/`. No ORM, no framework, no bundler config.
- **Tests**: vitest with `@cloudflare/vitest-plugin`; tests run inside workerd with a real local D1. Call the app with `app.request(url, init, env)` where `env` comes from `cloudflare:workers`. Never mock D1.
- **Secrets**: `PEPPER`, `TURNSTILE_SECRET`, `ADMIN_HANDLE` come from `wrangler secret put` in prod and `.dev.vars` locally. Public config like `TURNSTILE_SITE_KEY` lives in `wrangler.jsonc` `vars`.
- **Time**: all timestamps are integer Unix seconds. Use the shared `nowSec()` helper.
- **Ids**: `crypto.randomUUID()` for rows, `randomHex(32)` for session ids.
- **Writes that must be atomic**: use `c.env.DB.batch([...])`. A batch is one transaction; if any statement fails, none apply.
- **Never** add an UPDATE or DELETE on `posts` except `hidden` on the admin path.
- **Plans are the source of truth**: each plan carries full file contents. Copy them; do not redesign. When a plan and this PRD disagree on a detail, the plan wins and the PRD gets a fix-up commit.
- **Validation order** before every commit: `npm run types`, `npm run check`, `npm test`. All three must be green.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Hosting | Cloudflare Workers + D1 | Vercel + Supabase, Vercel + Neon | Free tier has no project pausing, unlimited static bandwidth, 5 GB DB |
| Auth | Generated 16-digit account number + handle | Email/password, OAuth, Better Auth | Anonymous, zero-friction, distinctive (Mullvad-inspired); user decision |
| Number storage | HMAC-SHA256 with env pepper | Argon2, bcrypt | High-entropy credential does not need slow hashing; slow hashing exceeds 10 ms CPU limit |
| Ledger | Append-only D1 table with hash chain | Solana, Arweave, Nostr | Free, no wallet, content still hideable; user withdrew Solana after cost/identity/moderation review |
| Immutability | No edit/delete, admin can hide | Full immutability | Host liability for anonymous content |
| Rendering | Server-rendered HTML via Hono, minimal JS | Astro, SvelteKit, React SPA | Bear-style speed on mobile is the core requirement |
| Categories | Free tags | Fixed entry kinds (Repov-style) | User choice |
| Autosave | localStorage first, server drafts second | Server-only | Local survives refresh with zero latency and zero cost |
| Domain | Free subdomain | Custom domain | User: "subdomain is okay" |
| License | MIT, public repo from day one | AGPL, closed | User: open source. MIT matches Bear and Mataroa; pepper, Turnstile key, and admin handle live only in Worker secrets, never in the repo |
| Social features | None | Comments, likes, follows | User decision; writing over engagement |
| Post length | No cap, 1 MB hard stop | 10k chars | User: same as Mataroa, which has none |
| Images | R2 with client-side re-encode | No images, Cloudflare Images | User wants images; R2 is free with zero egress; canvas re-encode strips EXIF for free |
| Spam | Turnstile + rate limits + freeze + `SIGNUP_OPEN` flag | Invite-only, proof-of-work, manual approval | All free, no user friction for humans, reversible |
| Number length | 16 digits | 20 digits | User choice; about 53 bits, adequate with rate limiting and HMAC pepper |
| Paging | Cursor on `rowid` | Page-number offsets | An offset shifts under you every time somebody publishes, which on an append-only timeline means re-reading rows you already saw |
| Hidden posts in filtered views | Placeholder on the global timeline, omitted from handle and tag pages and from feeds | Placeholder everywhere | On a page already filtered to one author or tag, a placeholder announces that this person or subject in particular had something taken down |
| Truncation | Stated as a known gap on `/verify` | Silently claim full tamper evidence | A chain read only from inside itself cannot prove entries were not cut from the end. The daily external anchor in the Could list is what would close it |
| Markdown renderer | micromark, no separate sanitizer | markdown-it, marked, plus a sanitizer | Escapes raw HTML and drops dangerous protocols at its safe defaults, so there is no sanitizer to misconfigure. Also the smallest of the three by a wide margin, which matters for Worker startup |
| Chain fork prevention | UNIQUE index on `posts.prev_hash` | Read the head then insert; a lock row | SQLite has no sha256, so the hash must be computed in JS, which makes read-then-insert a race. A unique parent makes a fork impossible to store at all, and the loser simply retries |
| Login challenge | Turnstile after the client's first failure | Turnstile on every login; none at all | Never challenging leaves guessing through rotating addresses cheap. Always challenging makes a third-party widget a single point of failure for accounts that cannot be recovered |
| Lock escalation | Doubling, 15 min to 24 h ceiling | Flat 15 min | A flat lock that resets its counter hands one client 5 fresh guesses every 15 minutes forever |
| Login throttle key | Client IP (HMAC'd) | Per account number | A per-number counter never fires against enumeration, since each guess is a new key, and it grows the table by one row per guess. Corrected during phase 2 implementation; see migration `0003_login_lockout_by_client.sql` |
| Recovery | None in v1, optional email later | Mandatory email, none ever | Keeps anonymous default; user wants an opt-in path eventually |

---

## Research Summary

**Market Context**
Bear Blog and Mataroa define the minimal, text-first, fast blog space. Bear supports tags and custom CSS and has a discovery feed; Mataroa organizes by date only. Both are single-author. Repov is a mobile-native mini-blog with typed entries (movies, books, places) and rich cards, but is slow to launch on the user's phone. No peer combines anonymous number-based accounts with a shared append-only timeline.

**Technical Context**
Hono on Cloudflare Workers with D1 is a well-documented stack. Key constraints: 10 ms CPU per request on free tier (rules out slow password hashing), one Drizzle instance per request, D1 is SQLite (no concern at this scale). Static assets binding serves CSS for free. Supabase free tier pauses inactive projects, which disqualifies it for a low-traffic personal site.

---

*Generated: 2026-09-09*
*Status: DRAFT - all open questions resolved, ready for /ecc:prp-plan*
