# Implementation Report: Account-Number Auth

Phase 2 of the pour PRD. Implemented, reviewed, fixed, deployed, and verified against production.

## Summary

Anonymous accounts are live. A visitor gets a randomly generated 16-digit account number and picks a handle; the number is the only credential and is shown exactly once. Sessions are HttpOnly cookies backed by D1. Signup is gated by Cloudflare Turnstile and a per-IP daily cap; login is throttled per client with a 15-minute lockout. The test stack moved to `@cloudflare/vitest-plugin` so tests exercise a real local D1.

Live at https://pour.rezaahmadn.workers.dev. Version ID `c38f19d5-ecd7-4c56-8447-4111bc2cda7d`.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large |
| Confidence | 8/10 | Justified. Two plan assumptions were wrong, both caught at the step that predicted them |
| Files changed | 21 | 25 |
| Tasks | 20 | 20 complete, plus 15 fixes across three review rounds |
| Tests | not predicted | 50 passing |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Upgrade test stack | Complete | vitest 4.1.11, `@cloudflare/vitest-plugin` 1.1.6 |
| 2 | tsconfig types | Complete | `@cloudflare/vitest-plugin/types` resolved as predicted |
| 3 | vitest config | Complete | `readD1Migrations` from package root as predicted |
| 4 | wrangler config | Complete | Rate-limit bindings confirmed working in local dev and production |
| 5 | Local secrets template | Complete | |
| 6 | Migration 0002 | Complete | |
| 7 | Test setup files | Complete | |
| 8 | Shared types | Complete | |
| 9 | Crypto helpers | Complete | |
| 10 | Account rules | Complete | |
| 11 | Turnstile verification | Complete | |
| 12 | Session and auth helpers | Complete | |
| 13 | Page layout | Complete | |
| 14 | Auth routes | Complete | Deviated, see below |
| 15 | Wire the app | Complete | Deviated, see below |
| 16 | Test helpers | Complete | Deviated, see below |
| 17 | Unit tests | Complete | |
| 18 | Route tests | Complete | Expanded from 19 to 50 cases |
| 19 | README | Complete | |
| 20 | Deploy checklist | Complete | Real Turnstile widget provisioned, secrets set, deployed |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static analysis | Pass | `wrangler types` and `tsc --noEmit` clean, strict mode |
| Unit tests | Pass | 50 tests, 3 files |
| CI simulation | Pass | Re-ran types, typecheck, and tests with `.dev.vars` removed, matching CI where secrets are absent |
| Local integration | Pass | Full signup, login, logout flow against `wrangler dev` with real local D1 |
| Production | Pass | See Production Verification |
| Edge cases | Pass | Oversized bodies, unicode and null-byte handles, forged session ids, foreign Origin, missing Origin |

## Deviations from Plan

1. **`fetchMock` no longer exists.** The plan specified `import { fetchMock } from "cloudflare:test"` based on the Cloudflare blog post. That export was removed in `@cloudflare/vitest-plugin` 1.x; only a vestigial `MockAgent` type remains. Replaced with a `vi.stubGlobal("fetch", ...)` stub in `test/helpers.ts` that serves queued Turnstile replies and throws on any other outbound call, preserving the plan's `disableNetConnect` semantics. `assertNoPendingMocks` preserves `assertNoPendingInterceptors`.

2. **Turnstile test secrets accept any token.** The plan's research note said test secret keys accept only the dummy token. They do not: `1x0000000000000000000000000000000AA` returns `success: true` for arbitrary input, flagged by `metadata.result_with_testing_key`. This made a garbage token succeed during local smoke testing. Not an application defect, but it meant shipping the test keys would have left signup completely unprotected. Resolved by provisioning a real widget rather than documenting the hazard.

3. **Reveal-page copy assertion.** A planned assertion checked for the signup form's wording on the number-reveal page. Corrected to assert the reveal page's own text.

## Review Findings and Fixes

Four rounds, converged. My own pass found the throttle defect and three hardening gaps. Two independent reviewers, one security and one TypeScript correctness, confirmed that fix and found six more issues, four of them real defects. A third review of the freshly written fixes then reproduced two concurrency bugs in that new code. A fourth round reviewed those fixes in turn and found nothing, which is where the loop stopped. Everything found is fixed, and each concurrency fix has a regression test that was checked by reverting the fix and confirming the test fails.

### Round 1

### 1. Login throttle keyed on the wrong value (high)

`login_failures` and the rate-limit binding were both keyed by the HMAC of the *submitted* number, per the PRD. A brute-force attempt submits a different number every time, so every attempt landed on a fresh key. The counter never reached the limit, the lockout never fired, and each guess appended a new row, giving an attacker a cheap way to grow the database without bound.

Fixed by keying both on the client address: migration `0003_login_lockout_by_client.sql` rekeys the table to `ip_hmac`, and the binding now uses the client IP. A malformed number is treated as a typo and does not consume an attempt. Three regression tests cover it, including one asserting that three distinct guesses from one client add exactly one row. PRD decisions log updated.

### 2. Credential renderable from cache (medium)

The number-reveal page had no cache directives. Added `Cache-Control: private, no-store` to every Worker response, which also keeps it out of the back-forward cache, plus `Referrer-Policy: same-origin` and `X-Content-Type-Options: nosniff`.

### 3. Unbounded request bodies (low)

A 5 MB form body was buffered for 3.9 seconds before being rejected as an invalid handle. Added a 16 KB `bodyLimit` to the three form POST routes, returning 413.

### 4. Turnstile token wasted on capped clients (low)

The per-IP daily cap was checked after the Turnstile network call, so a capped client spent its single-use token on a request that could not succeed. Cap now precedes verification. The mock-consumption guard in the test suite enforces the ordering.

### Round 2

### 5. Lost-update race on the failure counter (high)

The counter was read with a `SELECT`, incremented in application code, and written back as an absolute value. Two attempts in flight at once both read the same value and both wrote the same result, so a burst of parallel guesses recorded one failure instead of several and could run well past the limit before the lock engaged. The increment now happens inside a single upsert with `RETURNING`, so the database does the arithmetic. A test fires three simultaneous guesses and asserts the count reaches four.

### 6. Turnstile failure surfaced as a 500 (high)

`verifyTurnstile` promised in its own comment that network and parse failures count as false, but had no `try`/`catch`. An unreachable siteverify or a non-JSON body threw straight through to Hono's default handler. Now wrapped, and a test drives the throw path through a mock that rejects.

### 7. Free guesses through rotating addresses (high)

With no challenge on login and a flat lock that reset its counter on expiry, one address got five fresh guesses every fifteen minutes indefinitely, and an attacker rotating addresses paid nothing. This matters most when part of a number is already known, which shrinks the search space to something reachable. Two changes: a client with any failure on record must solve a Turnstile challenge on every further attempt, and each further run of five failures doubles the lock up to a 24-hour ceiling. The first attempt stays unchallenged on purpose, because an account has no recovery path and a blocked widget must never be the only barrier between someone and their own account.

### 8. Signup cap could be exceeded by concurrent requests (medium)

The cap was a `COUNT` read followed several awaits later by an insert, so simultaneous requests could all read a count below the limit and all proceed. The slot is now claimed by one guarded `INSERT ... SELECT ... WHERE (SELECT COUNT(*) ...) < ?`, with the earlier count kept only as a fast path that avoids reaching Turnstile when already capped. A test fires five simultaneous signups from one address and asserts at most three succeed.

### 9. Rate-limit bindings typed as optional (medium)

`src/env.ts` declared both limiters optional while wrangler generates them as required, so a renamed or deleted binding would have compiled clean and silently switched both throttles off. Now required. The reviewer believed the bindings were absent under test; a probe showed they are present and enforce exactly ten calls per minute, so there is now a test asserting the 429 branch.

### 10. Smaller items

The catch that mapped constraint violations to "handle is taken" matched any `UNIQUE` failure and now matches `users.handle` specifically, so a collision elsewhere surfaces instead of being mislabelled. Added `X-Frame-Options: DENY`. The login field, which carries the only credential, is now `type="password"` instead of plain text.

### 11. Challenge shown too late (found in a final read-through)

The login page decided whether to show a challenge only when a form was submitted, so a client with a failure on record would fill in the page, submit, and bounce off a check it had never been shown. The page now looks up the client's failure count and renders the challenge up front. For everyone else the third-party script is not on the page at all, which was confirmed in production: zero references for a clean client, the widget present after one failure.

## Production Verification

A fully automated signup is impossible by design: Turnstile blocks CDP-driven browsers, and it correctly refused two attempts through Chrome DevTools. Verified everything around it instead.

| Check | Result |
|---|---|
| Timeline, login, signup pages render | 200, real site key present, widget script loaded |
| Turnstile enforced | Garbage token and missing token both 400 |
| Session read path | Synthetic session row, then `/write` returned 200 with the handle |
| Logout | 302, session row deleted, subsequent `/write` redirected to login |
| CSRF | Missing Origin and foreign Origin both 403 |
| Lockout | Five distinct guesses from one client produced a 15-minute lock |
| Challenge escalation | First attempt unchallenged and 401; the next attempt without a token returned 400 and the widget appeared |
| Credential field | Rendered as `type="password"`, with no widget on a clean first visit |
| Frame protection | `X-Frame-Options: DENY` on every response |
| Row growth | One row per client, not one per guess |
| Body limit | 413 |
| Headers | Present on HTML, redirects, and error responses, 20 of 20 requests |
| Throttle key spoofing | Forged `CF-Connecting-IP` had no effect; the edge sets it |
| Latency | About 100 ms for reads, 135 to 200 ms for a login POST; 9 ms Worker startup |

All probe rows were removed. Production tables are back to zero rows across `users`, `sessions`, `signups`, `login_failures`, and `posts`.

One transient issue appeared mid-deploy: stale isolates briefly served the previous build against the new schema, producing intermittent 500s and missing headers. It cleared within seconds and was confirmed resolved over 20 consecutive requests.

### Round 3

The round-2 fixes were themselves reviewed, since nobody had seen that code. Two bugs were reproduced.

### 12. Concurrent attempts all skipped the challenge (high)

The decision to require a challenge came from a plain read taken before the attempt was recorded. Requests arriving together from one fresh client all saw "no failures yet", so a burst of five was judged against the account table with no challenge at all, five times the intended single free attempt, and repeatable for every new address. The exemption is now claimed with `INSERT ... ON CONFLICT DO NOTHING RETURNING`, so only the request that actually creates the row gets it and the rest are challenged. Verified in production: four simultaneous attempts from one fresh address returned one 401 and three 400.

### 13. Lost handle race burned the whole daily allowance (medium)

The daily signup slot was claimed before the account insert, so when a handle collision rejected the insert the slot stayed spent. Three simultaneous submissions of one handle consumed all three of a client's slots while creating a single account, blocking further signups from that address for the day. The catch now returns the slot.

### 14. CSRF rejections went out bare (low)

The header middleware sat inside `csrf()`, which throws without calling the next handler, so a 403 carried none of the new headers. The middleware now wraps `csrf()`. Verified in production: a rejected post returns all four headers.

### 15. Challenge shown inconsistently (found while reading the fixes)

The login page tested the failure count while the submit handler tested whether a row existed. The two disagreed about a row left at zero by a claimed-then-abandoned attempt, which would show a visitor a page with no challenge and then reject them for not solving one. Both now use the same rule.

### Round 4

An independent review of the round-3 fixes found no issues and required no changes. It confirmed the atomic claim admits exactly one request, that a stray zero-count row cannot farm exemptions or evade the lockout, that the slot refund can never delete more than one row and cannot be turned into cap evasion even when it targets a sibling row from the same second, and that Hono applies the relocated headers to a rejected request because it converts the rejection to a response at the throwing middleware rather than unwinding past the outer wrapper. This is where the review loop stopped.

## Verification of the New Code

The round-2 fixes introduced SQL that no reviewer had seen, so each piece was checked directly.

- **Escalation arithmetic**: ran the upsert 30 times against real SQLite and compared every value to an independent calculation. Locks land only on multiples of five and read 900, 1800, 3600, 7200, 14400, and 28800 seconds, matching exactly. The clamped shift cannot overflow, and the insert path sets count 1 with no lock.
- **`RETURNING` on an upsert and `meta.changes` on a guarded insert**: both are relied on by passing tests, so D1 supports them.
- **Flakiness**: the suite ran five consecutive times with 44 passing each time. One test sat exactly at the ten-per-minute rate limit with no headroom and was rewritten to use six requests instead of ten.
- **Full local flow**: against `wrangler dev` with a real local D1, signup issued a number, logout cleared the session, the first login attempt succeeded unchallenged, a wrong guess returned 401 and made the widget appear, the next attempt without a token returned 400, and the correct number with a token logged in.
- **Regression tests proven**: each of the four concurrency and consistency fixes was checked by reverting the fix and confirming its test fails, then restoring. None of them is vacuous.
- **Static checks**: no logging, no `raw()`, `innerHTML`, or `eval`, all twelve prepared statements use placeholders with no interpolated SQL, and no `UPDATE` or `DELETE` touches `posts`.
- **CSRF scope**: Hono's middleware deliberately ignores JSON bodies, since a cross-origin JSON POST needs a preflight the app never grants. Confirmed in production that a JSON signup returns 400 and creates nothing, while a `text/plain` post without an Origin returns 403.

## Infrastructure Provisioned

- Turnstile widget `pour`, managed mode, scoped to `pour.rezaahmadn.workers.dev`. Site key `0x4AAAAAAEuWB56FcmKTZlQw` committed to `wrangler.jsonc`, since site keys are public.
- Worker secrets now set: `PEPPER` (pre-existing, untouched), `TURNSTILE_SECRET`, `ADMIN_HANDLE`.
- Local development keeps Cloudflare's always-pass test keys via `.dev.vars`, so it works offline.

## Files Changed

| File | Action |
|---|---|
| `src/env.ts`, `src/crypto.ts`, `src/account.ts`, `src/turnstile.ts`, `src/auth.ts`, `src/layout.ts`, `src/routes/auth.ts` | Created |
| `src/index.ts` | Updated: csrf, response headers, session middleware, `/write` stub, routes |
| `migrations/0002_auth.sql`, `migrations/0003_login_lockout_by_client.sql` | Created |
| `test/helpers.ts`, `test/auth.test.ts`, `test/crypto.test.ts`, `test/apply-migrations.ts`, `test/env.d.ts` | Created |
| `test/health.test.ts` | Updated to pass `env` |
| `vitest.config.ts`, `tsconfig.json`, `package.json` | Updated for the new test stack |
| `wrangler.jsonc` | Updated: site key var, two rate-limit bindings |
| `.dev.vars.example` | Created |
| `README.md` | Updated: local secrets, Turnstile setup, pepper warning |
| `.claude/PRPs/prds/pour.prd.md` | Updated: phase status, throttle decision, executor notes |

## Tests Written

| Test file | Tests | Coverage |
|---|---|---|
| `test/crypto.test.ts` | 6 | Digit generation, HMAC determinism, number and handle normalization |
| `test/auth.test.ts` | 43 | Signup, login, logout, sessions, lockout, escalation, concurrency, challenge, CSRF, caps, headers, body limit |
| `test/health.test.ts` | 1 | Health endpoint |

## Known Limitations

- A successful production signup has not been exercised by a human. Everything around it is verified, but one manual signup in a real browser would close the loop.
- Expired sessions are never garbage-collected. Harmless; a cleanup can ride along with phase 8.
- `login_failures` rows are bounded at one per client but never pruned.
- The per-client lock means five bad guesses from one shared address, such as a carrier or campus network, briefly block others behind it. This is inherent to client-keyed throttling and is the accepted trade against unlimited guessing.
- There is no "log out everywhere". A stolen cookie is valid for up to 30 days and the owner cannot cut it short. Worth adding when account settings exist.
- If a signup loses a handle race after claiming its daily slot, the slot stays consumed. The race needs two identical handles within milliseconds.
- If `CF-Connecting-IP` were ever absent, all such clients would share one throttle bucket. Cloudflare always sets it on workers.dev.
- `npm audit` reports 4 high advisories, all from `sharp` inside `miniflare`, a development-only transitive dependency of wrangler. Not reachable from the deployed Worker; fixing requires an upstream release.

## Next Steps

- [ ] Commit and open a PR. Changes are on `feat/account-number-auth` and are not yet committed.
- [ ] One manual signup in a browser to confirm the Turnstile happy path.
- [ ] Phase 3, write and publish, and phase 4, design system, can start in parallel.
