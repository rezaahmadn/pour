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
- Image upload (v1) - storage and moderation cost; text first.
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

- [ ] Post length cap? (Suggest 10,000 characters; D1 row limits are far above this.)
- [ ] Will images ever be allowed? If yes, R2 is the free-tier path.
- [ ] Spam plan when strangers arrive: invite codes, proof-of-work, or manual approval?
- [ ] Does "pour" stay as the project name and subdomain?
- [ ] Recovery for lost account numbers: none (Mullvad-style) or optional recovery email later?
- [ ] 16 or 20 digit account numbers?

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
| Could | Public chain verification endpoint (`/verify`) | Lets anyone confirm integrity |
| Could | Passkey (WebAuthn) as optional second login method | Better UX; number remains fallback |
| Could | Dark mode via `prefers-color-scheme` | Small CSS cost |
| Could | Daily anchor of latest chain hash to an external system | External proof; only if cheap and simple |
| Won't | Comments, likes, follows, DMs | Out of scope by decision |
| Won't | Edit or delete published posts | Ledger |
| Won't | Images, search (v1) | Deferred |

### MVP Scope

Signup with generated number and handle, login, write a markdown post with tags, local autosave, global timeline, hash chain, admin hide. Deployed at a free `*.workers.dev` or `*.pages.dev` subdomain. Bear-inspired CSS with one accent color and system or one self-hosted font.

### User Flow

1. Open URL. Timeline renders server-side in one request.
2. Tap "write". If not logged in, see "Get an account number" and "I have a number" side by side.
3. "Get a number": server generates 16 random digits, user picks a handle, number is shown once with copy and download buttons and a warning that it cannot be recovered. Session cookie set.
4. Editor: single textarea plus tags field. Every keystroke autosaves to localStorage. Refresh or backgrounding restores it.
5. Publish: server inserts post, computes hash from previous hash, redirects to the post. Local draft cleared.
6. Post appears at top of timeline, on `/@handle`, and on each `/tag/:tag`.

---

## Technical Approach

**Feasibility**: HIGH

**Architecture Notes**
- Single Cloudflare Worker using Hono. Server-rendered HTML with `hono/html`. Static CSS and a small editor script served through the Workers static assets binding.
- D1 (SQLite) via Drizzle. One Drizzle instance per request, created in middleware, never a module-level singleton.
- Tables: `users(id, handle, number_hmac, created_at)`, `sessions(id, user_id, expires_at)`, `posts(id, user_id, body, created_at, prev_hash, hash, hidden)`, `tags(post_id, tag)`, `drafts(user_id, body, tags, updated_at)`.
- Hash chain: `hash = sha256(prev_hash || user_id || body || created_at)`. Insert happens inside a single D1 batch that reads the latest hash and writes the new row, to avoid forks under concurrent publishes.
- Account numbers: generated with `crypto.getRandomValues`, stored as HMAC-SHA256 with a secret pepper from Worker env. Slow hashing is unnecessary because the credential is high-entropy, and it would exceed the 10 ms free-tier CPU limit.
- Sessions: random 32-byte id in D1, HttpOnly Secure SameSite=Lax cookie, 30-day expiry.
- Rate limiting on login and signup: Cloudflare rate limiting rules on the free plan, plus per-account lockout after repeated failures.
- No edit/delete routes exist. The D1 access pattern uses INSERT and SELECT only for `posts`; the only UPDATE is `hidden` on the admin path.
- Admin: a single handle listed in Worker env is treated as admin.

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Free Workers 10 ms CPU limit on auth paths | M | HMAC instead of Argon2/bcrypt; measure with `wrangler dev` |
| Hash chain fork from concurrent publishes | L | Single D1 batch per publish; verify endpoint detects forks |
| Spam once public | M | Keep signup open only to Reza initially (invite code env flag); decide spam plan before opening |
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
| 1 | Scaffold and deploy | Hono + D1 + Drizzle worker, schema, CI deploy to workers.dev, hello-world timeline | pending | - | - | - |
| 2 | Account-number auth | Generate number, handle, HMAC storage, sessions, login/logout, rate limit | pending | - | 1 | - |
| 3 | Write and publish | Editor page, markdown render, tags, hash-chain insert, post page | pending | with 4 | 2 | - |
| 4 | Design system | Bear-inspired CSS, typography, layout, dark mode, mobile-first | pending | with 3 | 1 | - |
| 5 | Autosave | localStorage draft with restore, flush on visibilitychange/pagehide, clear on publish | pending | - | 3 | - |
| 6 | Timeline views | Global paginated timeline, `/@handle`, `/tag/:tag`, RSS | pending | with 7 | 3, 4 | - |
| 7 | Admin and ledger | Hide flag, admin route, `/verify` chain endpoint | pending | with 6 | 3 | - |
| 8 | Server drafts and polish | Drafts table sync, passkey (optional), signup gating flag | pending | - | 5, 6, 7 | - |

### Phase Details

**Phase 1: Scaffold and deploy**
- **Goal**: A deployed URL that renders a server-side page from D1.
- **Scope**: `wrangler` project, Hono app, Drizzle schema and migrations, GitHub Actions deploy, static assets binding.
- **Success signal**: `https://pour.<account>.workers.dev` returns a page listing rows from D1.

**Phase 2: Account-number auth**
- **Goal**: Anyone can get a number, pick a handle, and log in.
- **Scope**: Number generation, HMAC with pepper, `users` and `sessions` tables, cookie middleware, login/logout, lockout and rate limiting.
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
- **Scope**: Admin-only hide toggle, `/verify` endpoint that walks the chain, hidden placeholder in timeline.
- **Success signal**: Hidden post shows as "entry hidden" with hash intact; `/verify` reports OK.

**Phase 8: Server drafts and polish**
- **Goal**: Cross-device drafts and gated public opening.
- **Scope**: `drafts` upsert every 5 s, conflict rule by timestamp, `SIGNUP_OPEN` env flag with invite code, optional passkey.
- **Success signal**: Draft started on phone appears on laptop; signup closed unless flag set.

### Parallelism Notes

Phases 3 and 4 can run together after auth exists: one builds routes and data, the other builds CSS against static markup. Phases 6 and 7 are independent read paths on the same `posts` table. Phase 5 depends on the editor from phase 3. Phase 8 is the tail.

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
| Social features | None | Comments, likes, follows | User decision; writing over engagement |

---

## Research Summary

**Market Context**
Bear Blog and Mataroa define the minimal, text-first, fast blog space. Bear supports tags and custom CSS and has a discovery feed; Mataroa organizes by date only. Both are single-author. Repov is a mobile-native mini-blog with typed entries (movies, books, places) and rich cards, but is slow to launch on the user's phone. No peer combines anonymous number-based accounts with a shared append-only timeline.

**Technical Context**
Hono on Cloudflare Workers with D1 and Drizzle is a well-documented stack. Key constraints: 10 ms CPU per request on free tier (rules out slow password hashing), one Drizzle instance per request, D1 is SQLite (no concern at this scale). Static assets binding serves CSS for free. Supabase free tier pauses inactive projects, which disqualifies it for a low-traffic personal site.

---

*Generated: 2026-09-09*
*Status: DRAFT - needs validation*
