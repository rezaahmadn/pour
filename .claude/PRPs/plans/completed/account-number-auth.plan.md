# Plan: Account-Number Auth

## Summary
Add anonymous accounts to pour. A visitor gets a random 16-digit account number and picks a handle; the number is shown once and is the only credential. Login, logout, HttpOnly session cookies, Turnstile on signup, per-IP signup cap, per-number lockout, and Workers rate-limit bindings. Also migrates the test stack to `@cloudflare/vitest-plugin` so tests run against a real local D1.

Every file in this plan is given in full. Copy the contents exactly. Do not redesign.

## User Story
As a writer on a phone, I want to get an account in one tap with no email or password, so that I can start publishing within seconds and stay anonymous.

## Problem → Solution
Today the site has no accounts; only a hello-world timeline count → After this phase, `/signup` issues a number and session, `/login` accepts the number, `/logout` ends the session, and `/write` is gated behind login (stub page; the real editor is Phase 3).

## Metadata
- **Complexity**: Large
- **Source PRD**: `.claude/PRPs/prds/pour.prd.md`
- **PRD Phase**: Phase 2, Account-number auth
- **Estimated Files**: 21 (13 create, 8 update)

---

## UX Design

### Before
```
┌──────────────────────────────┐
│ pour                         │
│ A quiet place to write       │
│ anything. 0 posts so far.    │
└──────────────────────────────┘
```

### After
```
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ pour · write · log in        │   │ Get an account number        │
│                              │   │ No email, no password. You   │
│ A quiet place to write...    │──▶│ get a 16-digit number. Keep  │
└──────────────────────────────┘   │ it: it cannot be recovered.  │
        tap "write" while           │ handle [ reza____ ]          │
        logged out → /login         │ [Turnstile]                  │
                                    │ [ Get my number ]            │
                                    │ Already have one? Log in     │
                                    └──────────────┬───────────────┘
                                                   ▼
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ pour · write · @reza log out │   │ Your account number          │
│                              │   │ 1234 5678 9012 3456          │
│ write                        │◀──│ Save it now. Only shown once.│
│ Editor arrives in phase 3.   │   │ [Copy] [Download]            │
│ You are @reza.               │   │ Handle: @reza                │
└──────────────────────────────┘   │ → Start writing              │
                                    └──────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Header nav | none | `pour · write · log in` or `pour · write · @handle [log out]` | Logout is a POST form button |
| `/signup` | 404 | Handle field + Turnstile → number reveal page | Number shown once, status 201 |
| `/login` | 404 | Number field → redirect `/write` | Spaces/dashes in number are ignored |
| `/logout` | 404 | POST only → redirect `/` | Deletes session row and cookie |
| `/write` | 404 | Redirect `/login` if logged out; stub page if logged in | Phase 3 replaces the stub body |
| Wrong number | n/a | 401 with message; 5th failure → 429 locked 15 min | Lock applies even to the correct number |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/index.ts` | 1-32 | Current app shape; Bindings type and `html` template pattern to extend |
| P0 | `migrations/0001_init.sql` | 1-40 | `users` and `sessions` columns this phase writes to |
| P0 | `test/health.test.ts` | 1-10 | Test style (`app.request`) to keep |
| P1 | `wrangler.jsonc` | all | Where `vars` and `ratelimits` go; secret names in the comment |
| P1 | `tsconfig.json` | all | `types` array to extend |
| P1 | `vitest.config.ts` | all | Replaced wholesale |
| P2 | `README.md` | Develop and Deploy sections | Add `.dev.vars` and Turnstile steps |
| P2 | `.claude/PRPs/prds/pour.prd.md` | Executor Notes, Spam and Abuse, Technical Approach | Rules this plan follows |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Turnstile server validation | https://developers.cloudflare.com/turnstile/get-started/server-side-validation/ | `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` with JSON `{secret, response, remoteip}`; reply `{success: boolean}`; token field is `cf-turnstile-response`; tokens single-use, 5 min |
| Turnstile client widget | https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/ | `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer>` + `<div class="cf-turnstile" data-sitekey="...">` inside the form |
| Turnstile test keys | https://developers.cloudflare.com/turnstile/troubleshooting/testing/ | Site key `1x00000000000000000000AA` always passes; secret `1x0000000000000000000000000000000AA` always passes; work on localhost |
| Rate Limiting binding | https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ | `ratelimits: [{name, namespace_id: "1001", simple: {limit, period}}]`, period must be 10 or 60; `await env.X.limit({key})` → `{success}`; GA since 2025-09-19; wrangler ≥ 4.36 (we have 4.130) |
| Vitest plugin | https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/ | Package is `@cloudflare/vitest-plugin` (replaces `vitest-pool-workers`); needs vitest ≥ 4.1; `env` from `cloudflare:workers` |
| D1 migrations in tests | https://github.com/cloudflare/workers-sdk/tree/main/fixtures/vitest-plugin-examples/d1 | `readD1Migrations` in config → `TEST_MIGRATIONS` binding → `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` in a setup file |
| fetchMock | https://blog.cloudflare.com/workers-vitest-integration/ | `fetchMock` from `cloudflare:test`; `activate()`, `disableNetConnect()`, `.get(origin).intercept({method,path}).reply(status, body)`; each interceptor is consumed once |
| Test isolation | https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/ | Storage isolated per test **file**, not per test. Tests in one file share D1 rows |

---

## Patterns to Mirror

### NAMING_CONVENTION
```ts
// SOURCE: src/index.ts:4-6
type Bindings = { DB: D1Database };
const app = new Hono<{ Bindings: Bindings }>();
```
camelCase functions and variables, PascalCase types, UPPER_SNAKE constants, kebab-case file names, SQL tables snake_case plural.

### DATA_ACCESS
```ts
// SOURCE: src/index.ts:9-12
const { results } = await c.env.DB.prepare(
  "SELECT COUNT(*) AS n FROM posts WHERE hidden = 0",
).all<{ n: number }>();
const n = results[0]?.n ?? 0;
```
Raw D1. `.prepare(sql).bind(...).first<T>()` for one row, `.run()` for writes, `DB.batch([...])` for atomic multi-statement writes.

### HTML_RENDERING
```ts
// SOURCE: src/index.ts:13-27
return c.html(html`<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      ...
```
`html` from `hono/html`. Interpolated values are auto-escaped. Nested `html\`\`` fragments are not re-escaped.

### ERROR_HANDLING
No custom error class exists. Pattern for this phase: validation failures re-render the form with a message and a 4xx status; unexpected errors are thrown and Hono returns 500. No try/catch except around the signup batch (UNIQUE race).

### LOGGING_PATTERN
None in the codebase. Do not add `console.log`. Workers observability is on in `wrangler.jsonc`; 4xx/5xx are visible there.

### TEST_STRUCTURE
```ts
// SOURCE: test/health.test.ts:1-10
import { describe, it, expect } from "vitest";
import app from "../src/index";

describe("health", () => {
  it("returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
```
Keep `describe`/`it`/`expect`, keep calling `app.request`. This phase adds the third argument `env`.

### MIGRATION_STYLE
```sql
-- SOURCE: migrations/0001_init.sql:1-8
-- Append-only ledger. No UPDATE/DELETE on posts except the hidden flag (admin).
CREATE TABLE users (
  id TEXT PRIMARY KEY,
```
Leading comment stating intent, `INTEGER` seconds for timestamps, explicit index names `table_column`.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `package.json` | UPDATE | vitest 4.1 + `@cloudflare/vitest-plugin` |
| `tsconfig.json` | UPDATE | Add plugin types so `cloudflare:test` resolves |
| `vitest.config.ts` | UPDATE | Run tests in workerd with local D1 and migrations |
| `wrangler.jsonc` | UPDATE | `vars.TURNSTILE_SITE_KEY`, two `ratelimits` bindings |
| `.dev.vars.example` | CREATE | Local secrets template with Turnstile test keys |
| `migrations/0002_auth.sql` | CREATE | `signups` and `login_failures` tables |
| `src/env.ts` | CREATE | Shared `Bindings`, `Variables`, `User`, `AppEnv` types |
| `src/crypto.ts` | CREATE | HMAC, random digits, random hex, `nowSec` |
| `src/account.ts` | CREATE | Number and handle normalization and rules |
| `src/turnstile.ts` | CREATE | `verifyTurnstile` |
| `src/auth.ts` | CREATE | Session middleware, `requireAuth`, cookie helpers |
| `src/layout.ts` | CREATE | `page()` shell with nav |
| `src/routes/auth.ts` | CREATE | `/signup`, `/login`, `/logout` routes |
| `src/index.ts` | UPDATE | Mount middleware and routes, `/write` stub, use `page()` |
| `test/env.d.ts` | CREATE | Type `TEST_MIGRATIONS` and secret bindings on `Cloudflare.Env` |
| `test/apply-migrations.ts` | CREATE | Setup file applying D1 migrations |
| `test/helpers.ts` | CREATE | Form POST, cookie extraction, signup helper, Turnstile mock |
| `test/health.test.ts` | UPDATE | Pass `env` |
| `test/crypto.test.ts` | CREATE | Unit tests for crypto and account helpers |
| `test/auth.test.ts` | CREATE | Route tests for signup, login, logout, lockout, csrf |
| `README.md` | UPDATE | `.dev.vars` step, Turnstile widget step |

## NOT Building
- Editor, posts, tags, hash chain (Phase 3). `/write` is a stub only.
- CSS beyond what exists (Phase 4). No new styles except the `.error` and `.number` class names in markup.
- Account freeze enforcement and admin routes (Phase 7). `frozen` is read into `User` but never checked.
- `SIGNUP_OPEN` flag and invite codes (Phase 8).
- Passkeys, recovery email, session cleanup cron, "remember me" toggle.
- Cloudflare dashboard WAF rate-limit rules. Bindings replace them.
- Drizzle or any ORM.

---

## Step-by-Step Tasks

### Task 1: Upgrade test stack
- **ACTION**: Install vitest 4.1 and the Cloudflare vitest plugin.
- **IMPLEMENT**: Run exactly:
  ```bash
  npm install -D vitest@^4.1 @cloudflare/vitest-plugin@^1.1
  ```
  Then confirm `package.json` devDependencies contain `"@cloudflare/vitest-plugin": "^1.1.x"` and `"vitest": "^4.1.x"`. Scripts stay unchanged.
- **MIRROR**: n/a
- **IMPORTS**: n/a
- **GOTCHA**: Do not install `@cloudflare/vitest-pool-workers`; it is the old package and pins a different vitest. If npm reports a peer conflict, read the versions it prints and retry with those exact versions. Do not use `--legacy-peer-deps`.
- **VALIDATE**: `ls node_modules/@cloudflare/vitest-plugin/package.json` exists. Then run:
  ```bash
  node -e 'console.log(Object.keys(require("./node_modules/@cloudflare/vitest-plugin/package.json").exports))'
  ```
  EXPECT: `[ '.', './types' ]` (verified against 1.1.6 on 2026-09-09). `readD1Migrations` and `cloudflareTest` both come from the root export; the types entry is `@cloudflare/vitest-plugin/types`.

### Task 2: tsconfig types
- **ACTION**: Make `cloudflare:test` and `cloudflare:workers` imports typecheck.
- **IMPLEMENT**: Replace `tsconfig.json` with:
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "ES2022",
      "moduleResolution": "Bundler",
      "lib": ["ES2022"],
      "types": ["./worker-configuration.d.ts", "@cloudflare/vitest-plugin/types"],
      "strict": true,
      "noEmit": true,
      "skipLibCheck": true,
      "jsx": "react-jsx",
      "jsxImportSource": "hono/jsx"
    },
    "include": ["src", "test", "worker-configuration.d.ts"]
  }
  ```
- **MIRROR**: n/a
- **IMPORTS**: n/a
- **GOTCHA**: The `types` entry must be exactly `@cloudflare/vitest-plugin/types` (confirmed in Task 1). It declares the `cloudflare:test` module; `cloudflare:workers` is already declared by `worker-configuration.d.ts`.
- **VALIDATE**: `npm run types && npm run check` passes (nothing imports the modules yet, so this only proves the types entry resolves).

### Task 3: vitest config
- **ACTION**: Run tests inside workerd with migrations applied.
- **IMPLEMENT**: Replace `vitest.config.ts` with:
  ```ts
  import path from "node:path";
  import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
  import { defineConfig } from "vitest/config";

  export default defineConfig(async () => {
    const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
    return {
      plugins: [
        cloudflareTest({
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              PEPPER: "test-pepper",
              TURNSTILE_SECRET: "test-secret",
              TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
            },
          },
        }),
      ],
      test: {
        include: ["test/**/*.test.ts"],
        setupFiles: ["./test/apply-migrations.ts"],
      },
    };
  });
  ```
- **MIRROR**: n/a
- **IMPORTS**: shown in the file
- **GOTCHA**: `readD1Migrations` comes from the package root (confirmed in Task 1; there is no `/config` subpath in 1.1.x). `miniflare.bindings` override anything with the same name from `wrangler.jsonc`, which is why the Turnstile site key is set here too. `vitest.config.ts` is outside the `tsconfig.json` include list, so `import.meta.dirname` needs no Node types.
- **VALIDATE**: Deferred to Task 7 (needs the setup file).

### Task 4: wrangler config
- **ACTION**: Add the public site key var and two rate-limit bindings.
- **IMPLEMENT**: Replace `wrangler.jsonc` with:
  ```jsonc
  {
  	"$schema": "node_modules/wrangler/config-schema.json",
  	"name": "pour",
  	"main": "src/index.ts",
  	"compatibility_date": "2026-09-01",
  	"assets": {
  		"directory": "public"
  	},
  	"observability": {
  		"enabled": true
  	},
  	"d1_databases": [
  		{
  			"binding": "DB",
  			"database_name": "pour",
  			"database_id": "74130416-4b3e-4985-88f8-4b325d6e72a6",
  			"migrations_dir": "migrations"
  		}
  	],
  	// Public config. TURNSTILE_SITE_KEY below is Cloudflare's always-pass TEST key.
  	// Replace it with the real widget site key before opening signup to the public (see README).
  	"vars": {
  		"TURNSTILE_SITE_KEY": "1x00000000000000000000AA"
  	},
  	// Workers Rate Limiting bindings. Counters are per Cloudflare location, eventually consistent.
  	"ratelimits": [
  		{ "name": "LOGIN_LIMITER", "namespace_id": "1001", "simple": { "limit": 10, "period": 60 } },
  		{ "name": "SIGNUP_LIMITER", "namespace_id": "1002", "simple": { "limit": 5, "period": 60 } }
  	]
  	// Secrets (set with `wrangler secret put NAME`, never commit):
  	//   PEPPER            HMAC key for account numbers and IP hashes
  	//   TURNSTILE_SECRET  Cloudflare Turnstile server key
  	//   ADMIN_HANDLE      handle treated as admin
  }
  ```
- **MIRROR**: existing file (tabs, key order)
- **IMPORTS**: n/a
- **GOTCHA**: `period` may only be 10 or 60. `namespace_id` is a string containing an integer. Tabs are the existing indentation in this file; keep them.
- **VALIDATE**: `npm run types` regenerates `worker-configuration.d.ts`; `grep -n "LOGIN_LIMITER\|TURNSTILE_SITE_KEY" worker-configuration.d.ts` shows both.

### Task 5: Local secrets template
- **ACTION**: Give developers working local values.
- **IMPLEMENT**: Create `.dev.vars.example`:
  ```
  # Copy to .dev.vars (gitignored). These Turnstile values are Cloudflare's always-pass test keys.
  PEPPER=dev-pepper-change-me
  TURNSTILE_SECRET=1x0000000000000000000000000000000AA
  TURNSTILE_SITE_KEY=1x00000000000000000000AA
  ADMIN_HANDLE=reza
  ```
- **MIRROR**: n/a
- **IMPORTS**: n/a
- **GOTCHA**: `.gitignore` ignores `.dev.vars` but not `.dev.vars.example`. Commit the example, never the real file.
- **VALIDATE**: `git check-ignore .dev.vars.example` prints nothing (exit 1). `cp .dev.vars.example .dev.vars` locally.

### Task 6: Migration 0002
- **ACTION**: Add tables for the signup cap and login lockout.
- **IMPLEMENT**: Create `migrations/0002_auth.sql`:
  ```sql
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
  ```
- **MIRROR**: MIGRATION_STYLE
- **IMPORTS**: n/a
- **GOTCHA**: File name must sort after `0001_init.sql`; wrangler applies in name order.
- **VALIDATE**: `npm run db:migrate:local` applies 0002 without error.

### Task 7: Test setup files
- **ACTION**: Apply migrations before tests and type the test bindings.
- **IMPLEMENT**: Create `test/apply-migrations.ts`:
  ```ts
  import { applyD1Migrations } from "cloudflare:test";
  import { env } from "cloudflare:workers";

  // Setup files run outside per-file storage isolation and may run more than once.
  // applyD1Migrations only applies migrations not yet applied, so this is safe.
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  ```
  Create `test/env.d.ts`:
  ```ts
  // Test-only bindings injected by vitest.config.ts. Merged into the generated Cloudflare.Env.
  declare namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
      PEPPER: string;
      TURNSTILE_SECRET: string;
      TURNSTILE_SITE_KEY: string;
    }
  }
  ```
- **MIRROR**: Cloudflare D1 fixture (External Documentation)
- **IMPORTS**: shown
- **GOTCHA**: `test/env.d.ts` must have no top-level `import`/`export`, or it stops being a global declaration.
- **VALIDATE**: `npm test` still passes with only `health.test.ts` (it now runs inside workerd). If it fails on `cloudflare:test` resolution, revisit Task 2.

### Task 8: Shared types
- **ACTION**: One place for app-level Hono types.
- **IMPLEMENT**: Create `src/env.ts`:
  ```ts
  export type Bindings = {
    DB: D1Database;
    PEPPER: string;
    TURNSTILE_SECRET: string;
    TURNSTILE_SITE_KEY: string;
    ADMIN_HANDLE?: string;
    // Rate-limit bindings are optional so code works when a runtime lacks them (tests, older wrangler).
    LOGIN_LIMITER?: RateLimit;
    SIGNUP_LIMITER?: RateLimit;
  };

  export type User = { id: string; handle: string; frozen: number };

  export type Variables = { user: User | null };

  export type AppEnv = { Bindings: Bindings; Variables: Variables };
  ```
- **MIRROR**: NAMING_CONVENTION
- **IMPORTS**: none (`D1Database` and `RateLimit` are globals from `worker-configuration.d.ts`)
- **GOTCHA**: none
- **VALIDATE**: `npm run check`.

### Task 9: Crypto helpers
- **ACTION**: HMAC, random digits, random hex, time.
- **IMPLEMENT**: Create `src/crypto.ts`:
  ```ts
  const encoder = new TextEncoder();

  export function toHex(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += b.toString(16).padStart(2, "0");
    return s;
  }

  /** HMAC-SHA256(secret, message) as lowercase hex. Used for account numbers and IP addresses. */
  export async function hmacHex(secret: string, message: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
    return toHex(new Uint8Array(sig));
  }

  export function randomHex(bytes: number): string {
    return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
  }

  /** Uniform random decimal digits. Bytes >= 250 are discarded so `b % 10` is unbiased. */
  export function randomDigits(length: number): string {
    let out = "";
    while (out.length < length) {
      const bytes = crypto.getRandomValues(new Uint8Array(length));
      for (const b of bytes) {
        if (b < 250 && out.length < length) out += String(b % 10);
      }
    }
    return out;
  }

  /** Unix seconds. All timestamps in D1 use this. */
  export function nowSec(): number {
    return Math.floor(Date.now() / 1000);
  }
  ```
- **MIRROR**: NAMING_CONVENTION
- **IMPORTS**: none (Web Crypto is global)
- **GOTCHA**: `crypto.subtle` is async; every caller of `hmacHex` must `await`.
- **VALIDATE**: `npm run check`; Task 17 tests.

### Task 10: Account rules
- **ACTION**: Number and handle normalization.
- **IMPLEMENT**: Create `src/account.ts`:
  ```ts
  export const NUMBER_LENGTH = 16;
  export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
  export const RESERVED_HANDLES = new Set([
    "admin", "pour", "tag", "verify", "write", "login", "logout", "signup",
    "health", "static", "api", "rss", "feed", "me", "about", "help",
  ]);

  /** Strips everything except digits. Returns null unless exactly 16 digits remain. */
  export function normalizeNumber(input: string): string | null {
    const digits = input.replace(/\D/g, "");
    return digits.length === NUMBER_LENGTH ? digits : null;
  }

  /** "1234567890123456" -> "1234 5678 9012 3456" */
  export function formatNumber(digits: string): string {
    return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
  }

  /** Trims, lowercases, then enforces HANDLE_RE and the reserved list. */
  export function normalizeHandle(input: string): string | null {
    const h = input.trim().toLowerCase();
    if (!HANDLE_RE.test(h) || RESERVED_HANDLES.has(h)) return null;
    return h;
  }
  ```
- **MIRROR**: NAMING_CONVENTION
- **IMPORTS**: none
- **GOTCHA**: none
- **VALIDATE**: Task 17 tests.

### Task 11: Turnstile verification
- **ACTION**: Server-side token check.
- **IMPLEMENT**: Create `src/turnstile.ts`:
  ```ts
  export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

  /** Returns true only when Cloudflare confirms the token. Network or parse failures count as false. */
  export async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
    if (!token) return false;
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  }
  ```
- **MIRROR**: NAMING_CONVENTION
- **IMPORTS**: none
- **GOTCHA**: Tokens are single-use. Never call this twice for one form submission.
- **VALIDATE**: Task 18 signup tests (mocked via `fetchMock`).

### Task 12: Session and auth helpers
- **ACTION**: Cookie session loading, auth gate, cookie set/clear, client IP.
- **IMPLEMENT**: Create `src/auth.ts`:
  ```ts
  import type { Context } from "hono";
  import { createMiddleware } from "hono/factory";
  import { deleteCookie, getCookie, setCookie } from "hono/cookie";
  import type { AppEnv, User } from "./env";
  import { nowSec, randomHex } from "./crypto";

  export const SESSION_COOKIE = "session";
  export const SESSION_TTL_SEC = 30 * 24 * 60 * 60;

  function isHttps(c: Context<AppEnv>): boolean {
    return new URL(c.req.url).protocol === "https:";
  }

  /** Loads the current user from the session cookie into c.get("user"). Never blocks a request. */
  export const sessionMiddleware = createMiddleware<AppEnv>(async (c, next) => {
    c.set("user", null);
    const id = getCookie(c, SESSION_COOKIE);
    if (id) {
      const user = await c.env.DB.prepare(
        "SELECT users.id AS id, users.handle AS handle, users.frozen AS frozen " +
          "FROM sessions JOIN users ON users.id = sessions.user_id " +
          "WHERE sessions.id = ? AND sessions.expires_at > ?",
      )
        .bind(id, nowSec())
        .first<User>();
      c.set("user", user ?? null);
    }
    await next();
  });

  /** Redirects to /login when there is no user. Put it before handlers that need an account. */
  export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
    if (!c.get("user")) return c.redirect("/login");
    await next();
  });

  /** Builds the INSERT for a new session. Caller runs it (alone or inside a batch), then calls setSessionCookie. */
  export function newSessionStatement(
    c: Context<AppEnv>,
    userId: string,
  ): { id: string; stmt: D1PreparedStatement } {
    const id = randomHex(32);
    const stmt = c.env.DB.prepare(
      "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
    ).bind(id, userId, nowSec() + SESSION_TTL_SEC);
    return { id, stmt };
  }

  export function setSessionCookie(c: Context<AppEnv>, id: string): void {
    setCookie(c, SESSION_COOKIE, id, {
      httpOnly: true,
      secure: isHttps(c),
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_TTL_SEC,
    });
  }

  export function clearSessionCookie(c: Context<AppEnv>): void {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
  }

  export function clientIp(c: Context<AppEnv>): string {
    return c.req.header("cf-connecting-ip") ?? "0.0.0.0";
  }
  ```
- **MIRROR**: DATA_ACCESS
- **IMPORTS**: shown
- **GOTCHA**: `secure` is derived from the request URL so `wrangler dev` on `http://localhost:8787` still sets the cookie. Production is always https.
- **VALIDATE**: `npm run check`.

### Task 13: Page layout
- **ACTION**: One HTML shell with nav, used by every page.
- **IMPLEMENT**: Create `src/layout.ts`:
  ```ts
  import { html } from "hono/html";
  import type { User } from "./env";

  type PageOptions = {
    title: string;
    user: User | null;
    /** Extra tags for <head>, e.g. the Turnstile script. */
    head?: unknown;
    body: unknown;
  };

  export function page(opts: PageOptions) {
    const account = opts.user
      ? html`<span>@${opts.user.handle}</span>
          <form method="post" action="/logout" class="inline"><button type="submit">log out</button></form>`
      : html`<a href="/login">log in</a>`;
    return html`<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${opts.title}</title>
          <link rel="stylesheet" href="/style.css" />
          ${opts.head ?? ""}
        </head>
        <body>
          <header><a href="/">pour</a> · <a href="/write">write</a> · ${account}</header>
          <main>${opts.body}</main>
        </body>
      </html>`;
  }
  ```
- **MIRROR**: HTML_RENDERING
- **IMPORTS**: shown
- **GOTCHA**: Pass `html\`\`` fragments for `head` and `body`, never plain strings containing markup (plain strings get escaped).
- **VALIDATE**: `npm run check`.

### Task 14: Auth routes
- **ACTION**: Signup, login, logout.
- **IMPLEMENT**: Create `src/routes/auth.ts`:
  ```ts
  import { Hono } from "hono";
  import { html } from "hono/html";
  import { getCookie } from "hono/cookie";
  import type { ContentfulStatusCode } from "hono/utils/http-status";
  import type { AppEnv, User } from "../env";
  import { hmacHex, nowSec, randomDigits } from "../crypto";
  import { NUMBER_LENGTH, formatNumber, normalizeHandle, normalizeNumber } from "../account";
  import { verifyTurnstile } from "../turnstile";
  import {
    SESSION_COOKIE,
    clearSessionCookie,
    clientIp,
    newSessionStatement,
    setSessionCookie,
  } from "../auth";
  import { page } from "../layout";

  export const SIGNUPS_PER_IP_PER_DAY = 3;
  export const MAX_LOGIN_FAILURES = 5;
  export const LOCKOUT_SEC = 15 * 60;

  const turnstileHead = html`<link rel="preconnect" href="https://challenges.cloudflare.com" />
    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`;

  function signupForm(siteKey: string, error: string | null, handle = "") {
    return html`<h1>Get an account number</h1>
      <p>No email, no password. You get a 16-digit number. Keep it: it cannot be recovered.</p>
      ${error ? html`<p class="error">${error}</p>` : ""}
      <form method="post" action="/signup">
        <label>
          handle
          <input
            name="handle"
            required
            minlength="3"
            maxlength="20"
            pattern="[a-z0-9_]+"
            autocapitalize="none"
            autocomplete="off"
            value="${handle}"
          />
        </label>
        <div class="cf-turnstile" data-sitekey="${siteKey}" data-size="flexible"></div>
        <button type="submit">Get my number</button>
      </form>
      <p>Already have a number? <a href="/login">Log in</a></p>`;
  }

  function numberReveal(number: string, handle: string) {
    return html`<h1>Your account number</h1>
      <p class="number" id="number" data-digits="${number}">${formatNumber(number)}</p>
      <p>
        <strong>Save it now.</strong> This is the only time it is shown. There is no recovery: no
        email, no reset.
      </p>
      <p>
        <button type="button" id="copy">Copy</button>
        <a download="pour-account-${handle}.txt" href="data:text/plain,${number}">Download</a>
      </p>
      <p>Handle: @${handle}</p>
      <p><a href="/write">Start writing</a></p>
      <script>
        var digits = document.getElementById("number").dataset.digits;
        document.getElementById("copy").onclick = function () {
          navigator.clipboard.writeText(digits);
          this.textContent = "Copied";
        };
      </script>`;
  }

  function loginForm(error: string | null) {
    return html`<h1>Log in</h1>
      ${error ? html`<p class="error">${error}</p>` : ""}
      <form method="post" action="/login">
        <label>
          account number
          <input name="number" inputmode="numeric" autocomplete="off" required />
        </label>
        <button type="submit">Log in</button>
      </form>
      <p>No number yet? <a href="/signup">Get one</a></p>`;
  }

  export const authRoutes = new Hono<AppEnv>();

  authRoutes.get("/signup", (c) => {
    if (c.get("user")) return c.redirect("/write");
    return c.html(
      page({
        title: "Get a number",
        user: null,
        head: turnstileHead,
        body: signupForm(c.env.TURNSTILE_SITE_KEY, null),
      }),
    );
  });

  authRoutes.post("/signup", async (c) => {
    if (c.get("user")) return c.redirect("/write");
    const form = await c.req.parseBody();
    const rawHandle = typeof form.handle === "string" ? form.handle : "";
    const token =
      typeof form["cf-turnstile-response"] === "string" ? form["cf-turnstile-response"] : "";
    const ip = clientIp(c);
    const fail = (status: ContentfulStatusCode, message: string) =>
      c.html(
        page({
          title: "Get a number",
          user: null,
          head: turnstileHead,
          body: signupForm(c.env.TURNSTILE_SITE_KEY, message, rawHandle),
        }),
        status,
      );

    const handle = normalizeHandle(rawHandle);
    if (!handle) {
      return fail(400, "Handle must be 3 to 20 characters: lowercase letters, digits, underscore.");
    }
    if (c.env.SIGNUP_LIMITER) {
      const { success } = await c.env.SIGNUP_LIMITER.limit({ key: ip });
      if (!success) return fail(429, "Too many attempts. Try again in a minute.");
    }
    if (!(await verifyTurnstile(c.env.TURNSTILE_SECRET, token, ip))) {
      return fail(400, "Human check failed. Try again.");
    }

    const now = nowSec();
    const ipHmac = await hmacHex(c.env.PEPPER, "ip:" + ip);
    const recent = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM signups WHERE ip_hmac = ? AND created_at > ?",
    )
      .bind(ipHmac, now - 24 * 60 * 60)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) >= SIGNUPS_PER_IP_PER_DAY) {
      return fail(429, "Signup limit reached for today.");
    }
    const taken = await c.env.DB.prepare("SELECT 1 AS x FROM users WHERE handle = ?")
      .bind(handle)
      .first();
    if (taken) return fail(409, "That handle is taken.");

    const number = randomDigits(NUMBER_LENGTH);
    const numberHmac = await hmacHex(c.env.PEPPER, number);
    const userId = crypto.randomUUID();
    const session = newSessionStatement(c, userId);
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO users (id, handle, number_hmac, frozen, created_at) VALUES (?, ?, ?, 0, ?)",
        ).bind(userId, handle, numberHmac, now),
        session.stmt,
        c.env.DB.prepare("INSERT INTO signups (ip_hmac, created_at) VALUES (?, ?)").bind(
          ipHmac,
          now,
        ),
      ]);
    } catch (err) {
      // Two signups raced on the same handle; the UNIQUE index rejected the second.
      if (String(err).includes("UNIQUE")) return fail(409, "That handle is taken.");
      throw err;
    }
    setSessionCookie(c, session.id);
    const user: User = { id: userId, handle, frozen: 0 };
    return c.html(
      page({ title: "Your account number", user, body: numberReveal(number, handle) }),
      201,
    );
  });

  authRoutes.get("/login", (c) => {
    if (c.get("user")) return c.redirect("/write");
    return c.html(page({ title: "Log in", user: null, body: loginForm(null) }));
  });

  authRoutes.post("/login", async (c) => {
    if (c.get("user")) return c.redirect("/write");
    const form = await c.req.parseBody();
    const raw = typeof form.number === "string" ? form.number : "";
    const fail = (status: ContentfulStatusCode, message: string) =>
      c.html(page({ title: "Log in", user: null, body: loginForm(message) }), status);

    const number = normalizeNumber(raw);
    if (!number) return fail(400, "Enter your 16-digit account number.");
    const numberHmac = await hmacHex(c.env.PEPPER, number);
    if (c.env.LOGIN_LIMITER) {
      const { success } = await c.env.LOGIN_LIMITER.limit({ key: numberHmac });
      if (!success) return fail(429, "Too many attempts. Wait a minute.");
    }

    const now = nowSec();
    const failure = await c.env.DB.prepare(
      "SELECT count, locked_until FROM login_failures WHERE number_hmac = ?",
    )
      .bind(numberHmac)
      .first<{ count: number; locked_until: number }>();
    if (failure && failure.locked_until > now) {
      const minutes = Math.ceil((failure.locked_until - now) / 60);
      return fail(429, `Locked. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
    }

    const user = await c.env.DB.prepare("SELECT id, handle, frozen FROM users WHERE number_hmac = ?")
      .bind(numberHmac)
      .first<User>();
    if (!user) {
      // A lock that has expired starts the count over; otherwise keep counting.
      const count = failure && failure.locked_until === 0 ? failure.count + 1 : 1;
      const lockedUntil = count >= MAX_LOGIN_FAILURES ? now + LOCKOUT_SEC : 0;
      await c.env.DB.prepare(
        "INSERT INTO login_failures (number_hmac, count, locked_until) VALUES (?, ?, ?) " +
          "ON CONFLICT(number_hmac) DO UPDATE SET count = excluded.count, locked_until = excluded.locked_until",
      )
        .bind(numberHmac, count, lockedUntil)
        .run();
      if (lockedUntil) return fail(429, "Too many failed attempts. Locked for 15 minutes.");
      return fail(401, "That number is not recognised.");
    }

    const session = newSessionStatement(c, user.id);
    await c.env.DB.batch([
      session.stmt,
      c.env.DB.prepare("DELETE FROM login_failures WHERE number_hmac = ?").bind(numberHmac),
    ]);
    setSessionCookie(c, session.id);
    return c.redirect("/write");
  });

  authRoutes.post("/logout", async (c) => {
    const id = getCookie(c, SESSION_COOKIE);
    if (id) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    clearSessionCookie(c);
    return c.redirect("/");
  });
  ```
- **MIRROR**: DATA_ACCESS, HTML_RENDERING, ERROR_HANDLING
- **IMPORTS**: shown
- **GOTCHA**:
  - `fail()` takes `ContentfulStatusCode`, not `number`; that import is required or `c.html(..., status)` will not typecheck.
  - The `<script>` in `numberReveal` reads the digits from a `data-` attribute so nothing user-controlled is interpolated inside JavaScript.
  - Lock check happens before the user lookup, so a locked number stays locked even when the correct number is submitted.
  - `c.redirect` returns 302.
- **VALIDATE**: `npm run check`; Task 18 tests.

### Task 15: Wire the app
- **ACTION**: Mount csrf, session middleware, auth routes, `/write` stub; use `page()` on home.
- **IMPLEMENT**: Replace `src/index.ts` with:
  ```ts
  import { Hono } from "hono";
  import { html } from "hono/html";
  import { csrf } from "hono/csrf";
  import type { AppEnv } from "./env";
  import { requireAuth, sessionMiddleware } from "./auth";
  import { page } from "./layout";
  import { authRoutes } from "./routes/auth";

  const app = new Hono<AppEnv>();

  // Rejects form POSTs whose Origin (or Sec-Fetch-Site) is not this site. Browsers always send one.
  app.use(csrf());
  app.use(sessionMiddleware);

  app.get("/", async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM posts WHERE hidden = 0",
    ).all<{ n: number }>();
    const n = results[0]?.n ?? 0;
    return c.html(
      page({
        title: "pour",
        user: c.get("user"),
        body: html`<h1>pour</h1>
          <p>A quiet place to write anything. ${n} posts so far.</p>`,
      }),
    );
  });

  app.get("/health", (c) => c.text("ok"));

  // Stub until Phase 3 adds the editor. Exists so the login flow has a destination.
  app.get("/write", requireAuth, (c) => {
    const user = c.get("user")!;
    return c.html(
      page({
        title: "write",
        user,
        body: html`<h1>write</h1>
          <p>Editor arrives in phase 3. You are logged in as @${user.handle}.</p>`,
      }),
    );
  });

  app.route("/", authRoutes);

  export default app;
  ```
- **MIRROR**: existing `src/index.ts`
- **IMPORTS**: shown
- **GOTCHA**: `csrf()` must be registered before the routes. It only inspects non-GET requests with form content types, so `/health` and JSON APIs are untouched.
- **VALIDATE**: `npm run check`; `npm run dev` then `curl -i localhost:8787/signup` shows the form and the Turnstile div.

### Task 16: Test helpers
- **ACTION**: Shared utilities for route tests.
- **IMPLEMENT**: Create `test/helpers.ts`:
  ```ts
  import { env } from "cloudflare:workers";
  import { fetchMock } from "cloudflare:test";
  import app from "../src/index";

  export const ORIGIN = "http://localhost";

  let ipCounter = 1;
  /** A fresh private IP per call so the per-IP signup cap never trips by accident. */
  export function freshIp(): string {
    ipCounter += 1;
    return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
  }

  export function formPost(
    fields: Record<string, string>,
    opts: { cookie?: string; ip?: string; origin?: string | null } = {},
  ): RequestInit {
    const headers: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
      "cf-connecting-ip": opts.ip ?? freshIp(),
    };
    if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
    if (opts.cookie) headers.cookie = opts.cookie;
    return { method: "POST", headers, body: new URLSearchParams(fields).toString() };
  }

  export function sessionCookie(res: Response): string {
    const m = /session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "");
    if (!m) throw new Error("no session cookie in response");
    return `session=${m[1]}`;
  }

  /** Queues one Turnstile siteverify reply. Consumed by the next verifyTurnstile call. */
  export function mockTurnstile(success: boolean): void {
    fetchMock
      .get("https://challenges.cloudflare.com")
      .intercept({ method: "POST", path: "/turnstile/v0/siteverify" })
      .reply(200, { success });
  }

  export async function signup(
    handle: string,
    ip = freshIp(),
  ): Promise<{ status: number; number: string; cookie: string; body: string }> {
    mockTurnstile(true);
    const res = await app.request(
      `${ORIGIN}/signup`,
      formPost({ handle, "cf-turnstile-response": "tok" }, { ip }),
      env,
    );
    const body = await res.text();
    const m = /data-digits="(\d{16})"/.exec(body);
    if (!m) throw new Error(`signup failed with ${res.status}: ${body.slice(0, 200)}`);
    return { status: res.status, number: m[1], cookie: sessionCookie(res), body };
  }
  ```
- **MIRROR**: TEST_STRUCTURE
- **IMPORTS**: shown
- **GOTCHA**: `app.request(url, init, env)` uses an absolute URL so `csrf()` can compare the Origin header against the request origin. `env` is the third argument; Hono passes it through as `c.env`.
- **VALIDATE**: `npm run check`.

### Task 17: Unit tests for helpers
- **ACTION**: Cover crypto and account rules; pass `env` in the health test.
- **IMPLEMENT**: Replace `test/health.test.ts` with:
  ```ts
  import { env } from "cloudflare:workers";
  import { describe, it, expect } from "vitest";
  import app from "../src/index";

  describe("health", () => {
    it("returns ok", async () => {
      const res = await app.request("/health", undefined, env);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    });
  });
  ```
  Create `test/crypto.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { hmacHex, randomDigits, randomHex } from "../src/crypto";
  import { formatNumber, normalizeHandle, normalizeNumber } from "../src/account";

  describe("crypto", () => {
    it("randomDigits returns only digits of the requested length", () => {
      for (let i = 0; i < 20; i++) {
        expect(randomDigits(16)).toMatch(/^\d{16}$/);
      }
    });

    it("randomHex returns 2 hex chars per byte", () => {
      expect(randomHex(32)).toMatch(/^[0-9a-f]{64}$/);
    });

    it("hmacHex is deterministic and 64 hex chars", async () => {
      const a = await hmacHex("pepper", "1234567890123456");
      const b = await hmacHex("pepper", "1234567890123456");
      const c = await hmacHex("other", "1234567890123456");
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(a).toBe(b);
      expect(a).not.toBe(c);
    });
  });

  describe("account", () => {
    it("normalizeNumber strips separators and requires 16 digits", () => {
      expect(normalizeNumber("1234 5678-9012 3456")).toBe("1234567890123456");
      expect(normalizeNumber("123456789012345")).toBeNull();
      expect(normalizeNumber("12345678901234567")).toBeNull();
      expect(normalizeNumber("")).toBeNull();
    });

    it("formatNumber groups by four", () => {
      expect(formatNumber("1234567890123456")).toBe("1234 5678 9012 3456");
    });

    it("normalizeHandle lowercases, trims, and rejects bad or reserved handles", () => {
      expect(normalizeHandle("  Reza_1 ")).toBe("reza_1");
      expect(normalizeHandle("ab")).toBeNull();
      expect(normalizeHandle("a".repeat(21))).toBeNull();
      expect(normalizeHandle("has space")).toBeNull();
      expect(normalizeHandle("héllo")).toBeNull();
      expect(normalizeHandle("admin")).toBeNull();
      expect(normalizeHandle("Login")).toBeNull();
    });
  });
  ```
- **MIRROR**: TEST_STRUCTURE
- **IMPORTS**: shown
- **GOTCHA**: none
- **VALIDATE**: `npm test` passes these files.

### Task 18: Route tests
- **ACTION**: Cover every route and abuse rule.
- **IMPLEMENT**: Create `test/auth.test.ts`:
  ```ts
  import { env } from "cloudflare:workers";
  import { fetchMock } from "cloudflare:test";
  import { afterEach, beforeAll, describe, expect, it } from "vitest";
  import app from "../src/index";
  import { ORIGIN, formPost, freshIp, mockTurnstile, sessionCookie, signup } from "./helpers";

  beforeAll(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });

  afterEach(() => fetchMock.assertNoPendingInterceptors());

  describe("GET /signup", () => {
    it("renders the form with the Turnstile widget", async () => {
      const res = await app.request(`${ORIGIN}/signup`, undefined, env);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('name="handle"');
      expect(body).toContain('class="cf-turnstile"');
      expect(body).toContain("1x00000000000000000000AA");
    });
  });

  describe("POST /signup", () => {
    it("issues a 16-digit number, shows it once, and sets a session cookie", async () => {
      const { status, number, body } = await signup("alice");
      expect(status).toBe(201);
      expect(number).toMatch(/^\d{16}$/);
      expect(body).toContain(number.replace(/(\d{4})(?=\d)/g, "$1 "));
      expect(body).toContain("cannot be recovered");
    });

    it("sets an HttpOnly SameSite=Lax cookie", async () => {
      mockTurnstile(true);
      const res = await app.request(
        `${ORIGIN}/signup`,
        formPost({ handle: "bob", "cf-turnstile-response": "tok" }),
        env,
      );
      const cookie = res.headers.get("set-cookie") ?? "";
      expect(cookie).toMatch(/^session=[0-9a-f]{64};/);
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Path=/");
    });

    it("rejects an invalid handle before calling Turnstile", async () => {
      const res = await app.request(
        `${ORIGIN}/signup`,
        formPost({ handle: "no spaces", "cf-turnstile-response": "tok" }),
        env,
      );
      expect(res.status).toBe(400);
    });

    it("rejects a reserved handle", async () => {
      const res = await app.request(
        `${ORIGIN}/signup`,
        formPost({ handle: "admin", "cf-turnstile-response": "tok" }),
        env,
      );
      expect(res.status).toBe(400);
    });

    it("rejects when Turnstile says no", async () => {
      mockTurnstile(false);
      const res = await app.request(
        `${ORIGIN}/signup`,
        formPost({ handle: "carol", "cf-turnstile-response": "tok" }),
        env,
      );
      expect(res.status).toBe(400);
      expect(await res.text()).toContain("Human check failed");
    });

    it("rejects a duplicate handle with 409", async () => {
      await signup("dave");
      mockTurnstile(true);
      const res = await app.request(
        `${ORIGIN}/signup`,
        formPost({ handle: "Dave", "cf-turnstile-response": "tok" }),
        env,
      );
      expect(res.status).toBe(409);
    });

    it("caps signups at 3 per IP per day", async () => {
      const ip = freshIp();
      await signup("ip_one", ip);
      await signup("ip_two", ip);
      await signup("ip_three", ip);
      mockTurnstile(true);
      const res = await app.request(
        `${ORIGIN}/signup`,
        formPost({ handle: "ip_four", "cf-turnstile-response": "tok" }, { ip }),
        env,
      );
      expect(res.status).toBe(429);
    });

    it("rejects a form POST without an Origin header (csrf)", async () => {
      const res = await app.request(
        `${ORIGIN}/signup`,
        formPost({ handle: "eve", "cf-turnstile-response": "tok" }, { origin: null }),
        env,
      );
      expect(res.status).toBe(403);
    });
  });

  describe("session", () => {
    it("shows the handle in the nav when the cookie is valid", async () => {
      const { cookie } = await signup("frank");
      const res = await app.request(`${ORIGIN}/`, { headers: { cookie } }, env);
      expect(await res.text()).toContain("@frank");
    });

    it("shows log in when there is no cookie", async () => {
      const res = await app.request(`${ORIGIN}/`, undefined, env);
      expect(await res.text()).toContain('href="/login"');
    });

    it("gates /write", async () => {
      const anon = await app.request(`${ORIGIN}/write`, undefined, env);
      expect(anon.status).toBe(302);
      expect(anon.headers.get("location")).toBe("/login");
      const { cookie } = await signup("grace");
      const authed = await app.request(`${ORIGIN}/write`, { headers: { cookie } }, env);
      expect(authed.status).toBe(200);
      expect(await authed.text()).toContain("@grace");
    });
  });

  describe("POST /login", () => {
    it("logs in with the number, ignoring spaces, and redirects to /write", async () => {
      const { number } = await signup("heidi");
      const spaced = number.replace(/(\d{4})(?=\d)/g, "$1 ");
      const res = await app.request(`${ORIGIN}/login`, formPost({ number: spaced }), env);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/write");
      const cookie = sessionCookie(res);
      const home = await app.request(`${ORIGIN}/`, { headers: { cookie } }, env);
      expect(await home.text()).toContain("@heidi");
    });

    it("rejects a malformed number with 400", async () => {
      const res = await app.request(`${ORIGIN}/login`, formPost({ number: "1234" }), env);
      expect(res.status).toBe(400);
    });

    it("returns 401 for an unknown number and locks after 5 failures", async () => {
      const wrong = "9999000011112222";
      for (let i = 1; i <= 4; i++) {
        const res = await app.request(`${ORIGIN}/login`, formPost({ number: wrong }), env);
        expect(res.status, `attempt ${i}`).toBe(401);
      }
      const fifth = await app.request(`${ORIGIN}/login`, formPost({ number: wrong }), env);
      expect(fifth.status).toBe(429);
      const sixth = await app.request(`${ORIGIN}/login`, formPost({ number: wrong }), env);
      expect(sixth.status).toBe(429);
      expect(await sixth.text()).toContain("Locked");
    });

    it("locks are per number: another correct number still logs in", async () => {
      const { number } = await signup("ivan");
      const wrong = "8888000011112222";
      for (let i = 0; i < 5; i++) {
        await app.request(`${ORIGIN}/login`, formPost({ number: wrong }), env);
      }
      const ok = await app.request(`${ORIGIN}/login`, formPost({ number }), env);
      expect(ok.status).toBe(302);
    });
  });

  describe("POST /logout", () => {
    it("deletes the session and clears the cookie", async () => {
      const { cookie } = await signup("judy");
      const res = await app.request(`${ORIGIN}/logout`, formPost({}, { cookie }), env);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
      expect(res.headers.get("set-cookie")).toMatch(/session=;.*Max-Age=0/);
      const home = await app.request(`${ORIGIN}/`, { headers: { cookie } }, env);
      expect(await home.text()).not.toContain("@judy");
    });
  });
  ```
- **MIRROR**: TEST_STRUCTURE
- **IMPORTS**: shown
- **GOTCHA**:
  - All tests in this file share one D1, so every handle is unique and the lockout tests use their own fake numbers.
  - `mockTurnstile` queues exactly one reply. Call it once per signup POST. The `afterEach` assertion fails if a queued mock was never consumed, which catches tests that returned early.
  - `fetchMock.disableNetConnect()` makes any unmocked outbound `fetch` throw, so a missing mock shows up as a 500, not a silent pass.
- **VALIDATE**: `npm test` green.

### Task 19: README
- **ACTION**: Document local secrets and Turnstile setup.
- **IMPLEMENT**: In `README.md`, replace the Develop code block with:
  ```sh
  npm install
  cp .dev.vars.example .dev.vars
  npm run db:migrate:local
  npm run dev
  ```
  In Deploy step 2 (Worker secrets), add this paragraph after the three commands:
  ```
  `TURNSTILE_SECRET` comes from a Turnstile widget: Cloudflare dashboard > Turnstile > Add widget, hostname `pour.<your-subdomain>.workers.dev`, mode Managed. Paste the widget's **site key** into `vars.TURNSTILE_SITE_KEY` in `wrangler.jsonc` (it is public) and its **secret key** into the secret above. Until you do, `wrangler.jsonc` ships Cloudflare's always-pass test site key, which real secrets reject, so signup will fail in production.
  ```
- **MIRROR**: existing README tone (short imperative steps)
- **IMPORTS**: n/a
- **GOTCHA**: none
- **VALIDATE**: Commands in the README match `package.json` scripts.

### Task 20: Deploy checklist (manual, one time)
- **ACTION**: Make production actually work.
- **IMPLEMENT**, in order:
  1. Dashboard > Turnstile > Add widget for `pour.rezaahmadn.workers.dev`. Copy site key and secret.
  2. Edit `wrangler.jsonc` `vars.TURNSTILE_SITE_KEY` to the real site key. Commit.
  3. Run `npx wrangler secret put TURNSTILE_SECRET` and paste the secret.
  4. Run `openssl rand -hex 32 | npx wrangler secret put PEPPER` if not already set. Changing PEPPER later invalidates every account number, so set it once.
  5. Push to `main`. CI applies `0002_auth.sql` and deploys.
- **MIRROR**: README Deploy section
- **IMPORTS**: n/a
- **GOTCHA**: Steps 3 and 4 need `npx wrangler login` first (already done for Phase 1).
- **VALIDATE**: Open `https://pour.rezaahmadn.workers.dev/signup` on a phone, get a number, log out, log in with it.

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| randomDigits | 16 | 16 chars, all digits | |
| hmacHex | same secret+msg twice | identical 64-hex | |
| hmacHex | different secret | different output | |
| normalizeNumber | "1234 5678-9012 3456" | "1234567890123456" | separators |
| normalizeNumber | 15 or 17 digits | null | length |
| normalizeHandle | " Reza_1 " | "reza_1" | trim + case |
| normalizeHandle | "admin" | null | reserved |
| POST /signup | valid | 201, number in body, cookie | |
| POST /signup | bad handle | 400 | |
| POST /signup | Turnstile false | 400 | |
| POST /signup | duplicate handle | 409 | case-insensitive |
| POST /signup | 4th from same IP | 429 | cap |
| POST /signup | no Origin header | 403 | csrf |
| GET /write | no cookie | 302 /login | |
| POST /login | correct, spaced | 302 /write + cookie | |
| POST /login | 4 digits | 400 | |
| POST /login | unknown x5 | 401 x4 then 429 | lockout |
| POST /login | other number locked | 302 | lock is per number |
| POST /logout | with cookie | 302 /, Max-Age=0, session gone | |

### Edge Cases Checklist
- [x] Empty input (handle "", number "")
- [x] Maximum size input (handle 21 chars)
- [x] Invalid types (non-string form fields are treated as "")
- [x] Concurrent signup with same handle (UNIQUE catch → 409)
- [x] Network failure to Turnstile (`fetch` throws → 500; `!res.ok` → 400). Acceptable for v1.
- [x] Permission denied (csrf 403)
- [ ] Expired session: enforced by `expires_at > now` in the middleware SQL; not tested because it needs clock control

---

## Validation Commands

### Static Analysis
```bash
npm run types && npm run check
```
EXPECT: Zero type errors.

### Unit Tests
```bash
npm test
```
EXPECT: `test/health.test.ts`, `test/crypto.test.ts`, `test/auth.test.ts` all pass.

### Full Test Suite
Same command; there is one suite.

### Database Validation
```bash
npm run db:migrate:local
npx wrangler d1 execute pour --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```
EXPECT: `d1_migrations, drafts, login_failures, posts, sessions, signups, tags, users`.

### Browser Validation
```bash
npm run dev
```
Then in a browser at `http://localhost:8787`:
- [ ] Header shows `pour · write · log in`.
- [ ] `/write` redirects to `/login`.
- [ ] `/signup` shows the Turnstile widget (test key, always passes) and a handle field.
- [ ] Submitting shows a 16-digit number formatted in groups of four; Copy and Download work.
- [ ] Header now shows `@handle [log out]`; `/write` shows the stub.
- [ ] Log out. Log in with the number typed with spaces. Lands on `/write`.
- [ ] Wrong number 5 times shows the locked message.

### Manual Validation
- [ ] `git status` shows no `.dev.vars` or `worker-configuration.d.ts` staged.
- [ ] `grep -rn "console.log" src` returns nothing.

---

## Acceptance Criteria
- [ ] All 20 tasks completed
- [ ] `npm run types`, `npm run check`, `npm test` all green
- [ ] Signup shows the number exactly once (status 201, never on any later page)
- [ ] Login with the number works; wrong number fails; 5 failures lock for 15 minutes
- [ ] Turnstile verified server-side on every signup
- [ ] Per-IP cap of 3 signups per day enforced in D1
- [ ] No UPDATE or DELETE statement touches `posts`
- [ ] PRD Phase 2 status set to `complete` after merge

## Completion Checklist
- [ ] Code follows discovered patterns (raw D1, `html` template, `app.request` tests)
- [ ] Error handling matches codebase style (re-render form with 4xx)
- [ ] No logging added
- [ ] Tests follow test patterns
- [ ] No hardcoded secrets; only Cloudflare's published test keys appear in the repo
- [ ] README updated
- [ ] No scope additions beyond the `/write` stub
- [ ] Self-contained

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `@cloudflare/vitest-plugin` changes export names in a future release | L | Tests will not start | Task 1 pins `^1.1` and its VALIDATE prints the exports; 1.1.6 verified to have `.` and `./types` only |
| Rate-limit bindings absent in the test runtime | M | None | Bindings are optional in `Bindings`; code skips the check when undefined. Lockout logic is in D1 and fully tested |
| `csrf()` blocks real browsers that omit Origin | L | Signup broken | Modern browsers send Origin or Sec-Fetch-Site on form POSTs; Hono accepts either |
| Real Turnstile secret with test site key in prod | H until Task 20 done | Signup fails in prod | README and wrangler comment call it out; Task 20 is the fix |
| `PEPPER` rotated later | L | Every number stops working | README note: set once |
| Test file shares D1 across tests | M | Flaky handle collisions | Every test uses a unique handle and a fresh IP |

## Notes
- Phase 1 is complete (commit e1e4666, live URL verified returning the D1 count). This plan is Phase 2.
- PRD was updated alongside this plan: Phase 1 marked complete, Phase 2 in-progress, ORM note corrected to raw D1, rate limiting note corrected to Workers bindings, and an "Executor Notes" section added for smaller models.
- Rate-limit bindings replace the PRD's "Cloudflare rate limiting rule on the login path" so the whole abuse layer lives in the repo, which matters for an open-source project.
- Sessions are never garbage-collected in this phase. Expired rows are harmless; a cleanup can ride along with Phase 8.
- Design system (Phase 4) will style `.error`, `.number`, `.inline`, and `header`. Markup here uses those class names so Phase 4 needs no HTML changes.
