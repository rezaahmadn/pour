import { Hono } from "hono";
import { html } from "hono/html";
import { bodyLimit } from "hono/body-limit";
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
/** Each further run of failures doubles the lock, up to this ceiling. */
export const MAX_LOCKOUT_SEC = 24 * 60 * 60;

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
    <p class="note">Already have a number? <a href="/login">Log in</a></p>`;
}

function numberReveal(number: string, handle: string) {
  return html`<h1>Your account number</h1>
    <p class="number" id="number" data-digits="${number}">${formatNumber(number)}</p>
    <p>
      <strong>Save it now.</strong> This is the only time it is shown. There is no recovery: no
      email, no reset.
    </p>
    <p class="actions">
      <button type="button" id="copy">Copy</button>
      <a download="pour-account-${handle}.txt" href="data:text/plain,${number}">Download</a>
    </p>
    <p class="note">Handle: @${handle}</p>
    <p><a href="/write">Start writing</a></p>
    <script>
      var digits = document.getElementById("number").dataset.digits;
      document.getElementById("copy").onclick = function () {
        navigator.clipboard.writeText(digits);
        this.textContent = "Copied";
      };
    </script>`;
}

function loginForm(siteKey: string, error: string | null, challenge: boolean) {
  return html`<h1>Log in</h1>
    ${error ? html`<p class="error">${error}</p>` : ""}
    <form method="post" action="/login">
      <label>
        account number
        <input
          name="number"
          type="password"
          inputmode="numeric"
          autocomplete="one-time-code"
          required
        />
      </label>
      ${challenge
        ? html`<div class="cf-turnstile" data-sitekey="${siteKey}" data-size="flexible"></div>`
        : ""}
      <button type="submit">Log in</button>
    </form>
    <p class="note">No number yet? <a href="/signup">Get one</a></p>`;
}

// Claims the one unchallenged attempt a client is allowed. Only the request that
// actually inserts the row gets it back, so when several arrive together exactly
// one is exempt and the rest are challenged. Reading a plain SELECT here instead
// would hand every request in a concurrent burst the same "no failures yet" answer
// and let a whole run of guesses through without a challenge.
const CLAIM_FIRST_ATTEMPT_SQL =
  "INSERT INTO login_failures (ip_hmac, count, locked_until) VALUES (?, 0, 0) " +
  "ON CONFLICT(ip_hmac) DO NOTHING RETURNING count";

// Counts one failed attempt for this client and returns the new state. The
// increment happens inside SQL so two attempts in flight at once cannot both read
// the same count and overwrite each other, which would let a burst of parallel
// guesses slip past the limit. Every further run of MAX_LOGIN_FAILURES doubles the
// lock, capped at MAX_LOCKOUT_SEC. The shift is clamped so it cannot overflow.
const RECORD_FAILURE_SQL =
  "INSERT INTO login_failures (ip_hmac, count, locked_until) VALUES (?, 1, 0) " +
  "ON CONFLICT(ip_hmac) DO UPDATE SET " +
  "  count = login_failures.count + 1, " +
  "  locked_until = CASE WHEN (login_failures.count + 1) % ? = 0 " +
  "    THEN ? + MIN(? * (1 << MIN((login_failures.count + 1) / ? - 1, 20)), ?) " +
  "    ELSE 0 END " +
  "RETURNING count, locked_until";

// These forms carry a handle and a 16-digit number. Anything larger is abuse, and
// rejecting on Content-Length avoids buffering a large body just to discard it.
const formLimit = bodyLimit({
  maxSize: 16 * 1024,
  onError: (c) => c.text("Form too large", 413),
});

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

authRoutes.post("/signup", formLimit, async (c) => {
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
  const limit = await c.env.SIGNUP_LIMITER.limit({ key: ip });
  if (!limit.success) return fail(429, "Too many attempts. Try again in a minute.");
  // The daily cap is checked before Turnstile so a capped client is turned away
  // without spending its single-use token on a request that cannot succeed.
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
  if (!(await verifyTurnstile(c.env.TURNSTILE_SECRET, token, ip))) {
    return fail(400, "Human check failed. Try again.");
  }

  const taken = await c.env.DB.prepare("SELECT 1 AS x FROM users WHERE handle = ?")
    .bind(handle)
    .first();
  if (taken) return fail(409, "That handle is taken.");

  // Claiming the daily slot is one guarded statement, so two signups racing from
  // the same client cannot both read a count below the cap and both proceed. The
  // count above is only a fast path that avoids reaching Turnstile when capped.
  const claim = await c.env.DB.prepare(
    "INSERT INTO signups (ip_hmac, created_at) SELECT ?, ? " +
      "WHERE (SELECT COUNT(*) FROM signups WHERE ip_hmac = ? AND created_at > ?) < ?",
  )
    .bind(ipHmac, now, ipHmac, now - 24 * 60 * 60, SIGNUPS_PER_IP_PER_DAY)
    .run();
  if (!claim.meta.changes) return fail(429, "Signup limit reached for today.");

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
    ]);
  } catch (err) {
    // Two signups raced on the same handle and the UNIQUE index rejected this one.
    // Matched on the column so a collision on number_hmac or a session id is not
    // reported as a taken handle; those are re-thrown as a 500 instead of hidden.
    if (String(err).includes("users.handle")) {
      // Give the daily slot back. It was claimed before the insert, and without
      // this a handful of simultaneous submissions of one handle would burn a
      // client's whole allowance for the day while creating a single account.
      await c.env.DB.prepare(
        "DELETE FROM signups WHERE rowid IN " +
          "(SELECT rowid FROM signups WHERE ip_hmac = ? AND created_at = ? LIMIT 1)",
      )
        .bind(ipHmac, now)
        .run();
      return fail(409, "That handle is taken.");
    }
    throw err;
  }
  setSessionCookie(c, session.id);
  const user: User = { id: userId, handle, frozen: 0 };
  return c.html(
    page({ title: "Your account number", user, body: numberReveal(number, handle) }),
    201,
  );
});

authRoutes.get("/login", async (c) => {
  if (c.get("user")) return c.redirect("/write");
  // Show the challenge up front to a client that already has a failure on record,
  // rather than letting them fill in the form and bounce off a check they were
  // never shown. Costs one indexed lookup, and keeps the third-party script off
  // the page entirely for everyone else.
  // Challenge whenever a row exists at all, which is exactly what the POST handler
  // decides: its claim succeeds only when there is no row. Testing count > 0 here
  // instead would disagree with it over a row left at zero by an attempt that was
  // claimed and then abandoned, and the visitor would meet a check never shown.
  const seen = await c.env.DB.prepare("SELECT 1 AS x FROM login_failures WHERE ip_hmac = ?")
    .bind(await hmacHex(c.env.PEPPER, "ip:" + clientIp(c)))
    .first();
  const challenge = seen !== null;
  return c.html(
    page({
      title: "Log in",
      user: null,
      head: challenge ? turnstileHead : undefined,
      body: loginForm(c.env.TURNSTILE_SITE_KEY, null, challenge),
    }),
  );
});

authRoutes.post("/login", formLimit, async (c) => {
  if (c.get("user")) return c.redirect("/write");
  const form = await c.req.parseBody();
  const raw = typeof form.number === "string" ? form.number : "";
  const token =
    typeof form["cf-turnstile-response"] === "string" ? form["cf-turnstile-response"] : "";

  // Throttling is keyed by client, never by the submitted number. A brute-force
  // attempt sends a different number every time, so a per-number key would hand
  // every attempt a fresh counter and store one row per guess.
  const ip = clientIp(c);
  const ipHmac = await hmacHex(c.env.PEPPER, "ip:" + ip);
  const fail = (status: ContentfulStatusCode, message: string, challenge: boolean) =>
    c.html(
      page({
        title: "Log in",
        user: null,
        head: challenge ? turnstileHead : undefined,
        body: loginForm(c.env.TURNSTILE_SITE_KEY, message, challenge),
      }),
      status,
    );

  const limit = await c.env.LOGIN_LIMITER.limit({ key: ip });
  if (!limit.success) return fail(429, "Too many attempts. Wait a minute.", true);

  const now = nowSec();
  const failure = await c.env.DB.prepare(
    "SELECT count, locked_until FROM login_failures WHERE ip_hmac = ?",
  )
    .bind(ipHmac)
    .first<{ count: number; locked_until: number }>();

  if (failure && failure.locked_until > now) {
    const minutes = Math.ceil((failure.locked_until - now) / 60);
    return fail(429, `Locked. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, true);
  }

  // Malformed input is a typo, not a guess. Checked before the claim below so a
  // mistyped number neither burns an attempt nor puts the client on record.
  const number = normalizeNumber(raw);
  if (!number) return fail(400, "Enter your 16-digit account number.", failure !== null);

  // Every client gets exactly one attempt without a challenge, and after that must
  // solve one each time, which is what makes guessing through rotating addresses
  // expensive. That single exemption is deliberate: an account has no recovery
  // path, so a blocked or broken widget must never be the only thing standing
  // between someone and their own account. The exemption is claimed atomically so
  // requests arriving together cannot all take it.
  const claimed = await c.env.DB.prepare(CLAIM_FIRST_ATTEMPT_SQL)
    .bind(ipHmac)
    .first<{ count: number }>();
  const challenge = claimed === null;
  if (challenge && !(await verifyTurnstile(c.env.TURNSTILE_SECRET, token, ip))) {
    return fail(400, "Human check failed. Try again.", true);
  }

  const user = await c.env.DB.prepare("SELECT id, handle, frozen FROM users WHERE number_hmac = ?")
    .bind(await hmacHex(c.env.PEPPER, number))
    .first<User>();
  if (!user) {
    const recorded = await c.env.DB.prepare(RECORD_FAILURE_SQL)
      .bind(ipHmac, MAX_LOGIN_FAILURES, now, LOCKOUT_SEC, MAX_LOGIN_FAILURES, MAX_LOCKOUT_SEC)
      .first<{ count: number; locked_until: number }>();
    if (recorded && recorded.locked_until > now) {
      const minutes = Math.ceil((recorded.locked_until - now) / 60);
      return fail(429, `Too many failed attempts. Locked for ${minutes} minutes.`, true);
    }
    return fail(401, "That number is not recognised.", true);
  }

  const session = newSessionStatement(c, user.id);
  await c.env.DB.batch([
    session.stmt,
    c.env.DB.prepare("DELETE FROM login_failures WHERE ip_hmac = ?").bind(ipHmac),
  ]);
  setSessionCookie(c, session.id);
  return c.redirect("/write");
});

authRoutes.post("/logout", formLimit, async (c) => {
  const id = getCookie(c, SESSION_COOKIE);
  if (id) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
  clearSessionCookie(c);
  return c.redirect("/");
});
