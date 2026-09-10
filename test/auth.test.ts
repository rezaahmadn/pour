import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import app from "../src/index";
import { hmacHex } from "../src/crypto";
import { MAX_LOGIN_FAILURES } from "../src/routes/auth";
import {
  ORIGIN,
  assertNoPendingMocks,
  formPost,
  freshIp,
  installFetchMock,
  mockTurnstile,
  mockTurnstileNetworkFailure,
  sessionCookie,
  signup,
  uninstallFetchMock,
} from "./helpers";

beforeAll(() => installFetchMock());
afterAll(() => uninstallFetchMock());
afterEach(() => assertNoPendingMocks());

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
    expect(body).toContain("only time it is shown");
    expect(body).toContain("no recovery");
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

  it("rejects a missing Turnstile token without calling Cloudflare", async () => {
    const res = await app.request(`${ORIGIN}/signup`, formPost({ handle: "notoken" }), env);
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
    // No Turnstile mock is queued: the cap must short-circuit before the network
    // call, so the client does not spend its single-use token on a doomed request.
    // assertNoPendingMocks in afterEach fails the test if Turnstile is reached.
    const res = await app.request(
      `${ORIGIN}/signup`,
      formPost({ handle: "ip_four", "cf-turnstile-response": "tok" }, { ip }),
      env,
    );
    expect(res.status).toBe(429);
  });

  // The cap used to be a COUNT read followed several awaits later by an INSERT, so
  // requests arriving together could all read a count below the limit and all pass.
  it("holds the daily cap when signups arrive together", async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) mockTurnstile(true);
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        app.request(
          `${ORIGIN}/signup`,
          formPost({ handle: `burst_${n}_${ip.replace(/\./g, "")}`, "cf-turnstile-response": "tok" }, { ip }),
          env,
        ),
      ),
    );
    const created = results.filter((r) => r.status === 201).length;
    expect(created).toBeLessThanOrEqual(3);
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM signups WHERE ip_hmac = ?")
      .bind(await hmacHex(env.PEPPER, "ip:" + ip))
      .first<{ n: number }>();
    expect(row?.n).toBeLessThanOrEqual(3);
    expect(row?.n).toBe(created);
  });

  // The slot was claimed before the user insert, so a lost handle race used to
  // consume it anyway. A few simultaneous submissions of one handle could burn a
  // client's whole daily allowance while creating a single account.
  it("gives the daily slot back when a handle race is lost", async () => {
    const ip = freshIp();
    const handle = `race_${ip.replace(/\./g, "")}`;
    for (let i = 0; i < 3; i++) mockTurnstile(true);
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        app.request(
          `${ORIGIN}/signup`,
          formPost({ handle, "cf-turnstile-response": "tok" }, { ip }),
          env,
        ),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM signups WHERE ip_hmac = ?")
      .bind(await hmacHex(env.PEPPER, "ip:" + ip))
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("rejects a form POST without an Origin header (csrf)", async () => {
    const res = await app.request(
      `${ORIGIN}/signup`,
      formPost({ handle: "eve", "cf-turnstile-response": "tok" }, { origin: null }),
      env,
    );
    expect(res.status).toBe(403);
  });

  it("rejects a form POST from a foreign Origin (csrf)", async () => {
    const res = await app.request(
      `${ORIGIN}/signup`,
      formPost(
        { handle: "mallory", "cf-turnstile-response": "tok" },
        { origin: "https://evil.example" },
      ),
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

  it("ignores a forged session id", async () => {
    const res = await app.request(
      `${ORIGIN}/write`,
      { headers: { cookie: `session=${"0".repeat(64)}` } },
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
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

  it("redirects a logged-in visitor away from /signup and /login", async () => {
    const { cookie } = await signup("karl");
    const s = await app.request(`${ORIGIN}/signup`, { headers: { cookie } }, env);
    expect(s.status).toBe(302);
    expect(s.headers.get("location")).toBe("/write");
    const l = await app.request(`${ORIGIN}/login`, { headers: { cookie } }, env);
    expect(l.status).toBe(302);
    expect(l.headers.get("location")).toBe("/write");
  });
});

describe("POST /login", () => {
  // A client with no failures on record is not challenged, so these tests queue a
  // Turnstile reply only for the attempts that come after the first failure.
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

  it("does not challenge a client's first attempt", async () => {
    const res = await app.request(`${ORIGIN}/login`, formPost({ number: "9090000011112222" }), env);
    expect(res.status).toBe(401);
  });

  it("requires a solved challenge once the client has failed", async () => {
    const ip = freshIp();
    const first = await app.request(
      `${ORIGIN}/login`,
      formPost({ number: "9090000011112223" }, { ip }),
      env,
    );
    expect(first.status).toBe(401);
    expect(await first.text()).toContain("cf-turnstile");

    const noToken = await app.request(
      `${ORIGIN}/login`,
      formPost({ number: "9090000011112224" }, { ip }),
      env,
    );
    expect(noToken.status).toBe(400);
    expect(await noToken.text()).toContain("Human check failed");

    mockTurnstile(true);
    const withToken = await app.request(
      `${ORIGIN}/login`,
      formPost({ number: "9090000011112225", "cf-turnstile-response": "tok" }, { ip }),
      env,
    );
    expect(withToken.status).toBe(401);
  });

  // The challenge decision used to come from a plain read taken before the attempt
  // was recorded, so a burst from one fresh client all saw "no failures yet" and
  // every one of them was let through unchallenged.
  it("exempts only one attempt when a burst arrives from a fresh client", async () => {
    const ip = freshIp();
    const results = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        app.request(
          `${ORIGIN}/login`,
          formPost({ number: `212100001111000${n}` }, { ip }),
          env,
        ),
      ),
    );
    const statuses = results.map((r) => r.status);
    // One attempt takes the single exemption and is judged on the number itself.
    // The rest carried no token, so they must be turned away by the challenge.
    expect(statuses.filter((s) => s === 401)).toHaveLength(1);
    expect(statuses.filter((s) => s === 400)).toHaveLength(3);
  });

  it("returns 400 rather than 500 when Turnstile is unreachable", async () => {
    const ip = freshIp();
    await app.request(`${ORIGIN}/login`, formPost({ number: "9191000011112222" }, { ip }), env);
    mockTurnstileNetworkFailure();
    const res = await app.request(
      `${ORIGIN}/login`,
      formPost({ number: "9191000011112223", "cf-turnstile-response": "tok" }, { ip }),
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Human check failed");
  });

  it("rejects a malformed number with 400", async () => {
    const res = await app.request(`${ORIGIN}/login`, formPost({ number: "1234" }), env);
    expect(res.status).toBe(400);
  });

  it("returns 401 for an unknown number and locks the client after 5 failures", async () => {
    const ip = freshIp();
    const wrong = "9999000011112222";
    for (let i = 1; i <= 4; i++) {
      if (i > 1) mockTurnstile(true);
      const res = await app.request(
        `${ORIGIN}/login`,
        formPost({ number: wrong, "cf-turnstile-response": "tok" }, { ip }),
        env,
      );
      expect(res.status, `attempt ${i}`).toBe(401);
    }
    mockTurnstile(true);
    const fifth = await app.request(
      `${ORIGIN}/login`,
      formPost({ number: wrong, "cf-turnstile-response": "tok" }, { ip }),
      env,
    );
    expect(fifth.status).toBe(429);
    // A locked client is turned away before Turnstile, so no reply is queued here.
    const sixth = await app.request(
      `${ORIGIN}/login`,
      formPost({ number: wrong, "cf-turnstile-response": "tok" }, { ip }),
      env,
    );
    expect(sixth.status).toBe(429);
    expect(await sixth.text()).toContain("Locked");
  });

  // Regression: the lockout used to be keyed by the submitted number, so an attacker
  // who varied the number on every attempt got a fresh counter each time and was
  // never throttled, while every guess appended a row to login_failures.
  it("locks a client that guesses a different number every time", async () => {
    const ip = freshIp();
    for (let i = 0; i < 4; i++) {
      if (i > 0) mockTurnstile(true);
      const res = await app.request(
        `${ORIGIN}/login`,
        formPost({ number: `77770000111122${10 + i}`, "cf-turnstile-response": "tok" }, { ip }),
        env,
      );
      expect(res.status, `guess ${i}`).toBe(401);
    }
    mockTurnstile(true);
    const fifth = await app.request(
      `${ORIGIN}/login`,
      formPost({ number: "7777000011112299", "cf-turnstile-response": "tok" }, { ip }),
      env,
    );
    expect(fifth.status).toBe(429);
  });

  it("stores one lockout row per client, not one per guess", async () => {
    const ip = freshIp();
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_failures").first<{
      n: number;
    }>();
    for (let i = 0; i < 3; i++) {
      if (i > 0) mockTurnstile(true);
      await app.request(
        `${ORIGIN}/login`,
        formPost({ number: `66660000111122${30 + i}`, "cf-turnstile-response": "tok" }, { ip }),
        env,
      );
    }
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_failures").first<{
      n: number;
    }>();
    expect((after?.n ?? 0) - (before?.n ?? 0)).toBe(1);
  });

  // Counting in application code let two attempts in flight at once read the same
  // value and write it back, recording one failure for two guesses.
  it("counts every guess when attempts arrive together", async () => {
    const ip = freshIp();
    await app.request(`${ORIGIN}/login`, formPost({ number: "5555000011112200" }, { ip }), env);
    for (let i = 0; i < 3; i++) mockTurnstile(true);
    await Promise.all(
      [1, 2, 3].map((n) =>
        app.request(
          `${ORIGIN}/login`,
          formPost({ number: `555500001111220${n}`, "cf-turnstile-response": "tok" }, { ip }),
          env,
        ),
      ),
    );
    const row = await env.DB.prepare("SELECT count FROM login_failures WHERE ip_hmac = ?")
      .bind(await hmacHex(env.PEPPER, "ip:" + ip))
      .first<{ count: number }>();
    expect(row?.count).toBe(4);
  });

  it("doubles the lock on the next run of failures", async () => {
    const ip = freshIp();
    const ipHmac = await hmacHex(env.PEPPER, "ip:" + ip);
    const guess = async (n: number, challenged: boolean) => {
      if (challenged) mockTurnstile(true);
      return app.request(
        `${ORIGIN}/login`,
        formPost({ number: `444400001111${2000 + n}`, "cf-turnstile-response": "tok" }, { ip }),
        env,
      );
    };
    for (let i = 0; i < 5; i++) await guess(i, i > 0);
    const first = await env.DB.prepare("SELECT count, locked_until FROM login_failures WHERE ip_hmac = ?")
      .bind(ipHmac)
      .first<{ count: number; locked_until: number }>();
    expect(first?.count).toBe(5);
    const firstLock = (first?.locked_until ?? 0) - Math.floor(Date.now() / 1000);
    expect(firstLock).toBeGreaterThan(14 * 60);
    expect(firstLock).toBeLessThanOrEqual(15 * 60);

    // Wind the clock forward the way waiting out the lock would, and advance the
    // counter to the edge of the next run. Doing the remaining four attempts for
    // real would put this one client at exactly the per-minute rate limit, leaving
    // the test no headroom. The arithmetic itself is exercised by the guess below.
    await env.DB.prepare(
      "UPDATE login_failures SET locked_until = 0, count = ? WHERE ip_hmac = ?",
    )
      .bind(MAX_LOGIN_FAILURES * 2 - 1, ipHmac)
      .run();
    await guess(9, true);
    const second = await env.DB.prepare("SELECT count, locked_until FROM login_failures WHERE ip_hmac = ?")
      .bind(ipHmac)
      .first<{ count: number; locked_until: number }>();
    expect(second?.count).toBe(10);
    const secondLock = (second?.locked_until ?? 0) - Math.floor(Date.now() / 1000);
    expect(secondLock).toBeGreaterThan(29 * 60);
    expect(secondLock).toBeLessThanOrEqual(30 * 60);
  });

  it("a locked client does not affect a different client", async () => {
    const { number } = await signup("ivan");
    const attacker = freshIp();
    for (let i = 0; i < 5; i++) {
      if (i > 0) mockTurnstile(true);
      await app.request(
        `${ORIGIN}/login`,
        formPost({ number: "8888000011112222", "cf-turnstile-response": "tok" }, { ip: attacker }),
        env,
      );
    }
    const locked = await app.request(
      `${ORIGIN}/login`,
      formPost({ number, "cf-turnstile-response": "tok" }, { ip: attacker }),
      env,
    );
    expect(locked.status).toBe(429);
    const ok = await app.request(`${ORIGIN}/login`, formPost({ number }, { ip: freshIp() }), env);
    expect(ok.status).toBe(302);
  });

  it("a malformed number does not count as a failed attempt", async () => {
    const ip = freshIp();
    for (let i = 0; i < 6; i++) {
      const res = await app.request(`${ORIGIN}/login`, formPost({ number: "12" }, { ip }), env);
      expect(res.status, `typo ${i}`).toBe(400);
    }
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM login_failures WHERE ip_hmac = ?",
    )
      .bind(await hmacHex(env.PEPPER, "ip:" + ip))
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("clears the client's failure counter after a successful login", async () => {
    const ip = freshIp();
    const { number } = await signup("lena");
    const wrongDigits = number.replace(/^\d/, (d) => String((Number(d) + 1) % 10));
    await app.request(`${ORIGIN}/login`, formPost({ number: wrongDigits }, { ip }), env);
    const ipHmac = await hmacHex(env.PEPPER, "ip:" + ip);
    const during = await env.DB.prepare("SELECT count FROM login_failures WHERE ip_hmac = ?")
      .bind(ipHmac)
      .first<{ count: number }>();
    expect(during?.count).toBe(1);
    mockTurnstile(true);
    const ok = await app.request(
      `${ORIGIN}/login`,
      formPost({ number, "cf-turnstile-response": "tok" }, { ip }),
      env,
    );
    expect(ok.status).toBe(302);
    const after = await env.DB.prepare("SELECT count FROM login_failures WHERE ip_hmac = ?")
      .bind(ipHmac)
      .first<{ count: number }>();
    expect(after).toBeNull();
  });

  it("rate limits a client to 10 attempts a minute", async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      const res = await app.request(`${ORIGIN}/login`, formPost({ number: "12" }, { ip }), env);
      expect(res.status, `attempt ${i}`).toBe(400);
    }
    const limited = await app.request(
      `${ORIGIN}/login`,
      formPost({ number: "12" }, { ip }),
      env,
    );
    expect(limited.status).toBe(429);
    expect(await limited.text()).toContain("Wait a minute");
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
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE id = ?")
      .bind(cookie.replace("session=", ""))
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

describe("response hardening", () => {
  it("masks the credential field on the login form", async () => {
    const res = await app.request(`${ORIGIN}/login`, undefined, env);
    const body = await res.text();
    expect(body).toContain('type="password"');
  });

  it("keeps the challenge script off the login page for a clean client", async () => {
    const res = await app.request(
      `${ORIGIN}/login`,
      { headers: { "cf-connecting-ip": freshIp() } },
      env,
    );
    const body = await res.text();
    expect(body).not.toContain("class=\"cf-turnstile\"");
    expect(body).not.toContain("challenges.cloudflare.com");
  });

  // A row left at zero by a claimed-then-abandoned attempt must still make the page
  // show the challenge, because the submit handler will insist on one either way.
  it("shows the challenge for a client on record even at zero failures", async () => {
    const ip = freshIp();
    await env.DB.prepare(
      "INSERT INTO login_failures (ip_hmac, count, locked_until) VALUES (?, 0, 0)",
    )
      .bind(await hmacHex(env.PEPPER, "ip:" + ip))
      .run();
    const page = await app.request(`${ORIGIN}/login`, { headers: { "cf-connecting-ip": ip } }, env);
    expect(await page.text()).toContain("class=\"cf-turnstile\"");
    const submitted = await app.request(
      `${ORIGIN}/login`,
      formPost({ number: "1717000011112222" }, { ip }),
      env,
    );
    expect(submitted.status).toBe(400);
  });

  it("shows the challenge on the login page once the client has failed", async () => {
    const ip = freshIp();
    await app.request(`${ORIGIN}/login`, formPost({ number: "3131000011112222" }, { ip }), env);
    const res = await app.request(`${ORIGIN}/login`, { headers: { "cf-connecting-ip": ip } }, env);
    const body = await res.text();
    expect(body).toContain("class=\"cf-turnstile\"");
    expect(body).toContain("challenges.cloudflare.com");
  });

  it("marks the account number page uncacheable", async () => {
    const ip = freshIp();
    mockTurnstile(true);
    const res = await app.request(
      `${ORIGIN}/signup`,
      formPost({ handle: "nina", "cf-turnstile-response": "tok" }, { ip }),
      env,
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("still sets the headers on a csrf rejection", async () => {
    const res = await app.request(
      `${ORIGIN}/signup`,
      formPost({ handle: "hdrcsrf" }, { origin: null }),
      env,
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("marks the timeline uncacheable because it shows the viewer's handle", async () => {
    const res = await app.request(`${ORIGIN}/`, undefined, env);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects an oversized form body", async () => {
    const res = await app.request(
      `${ORIGIN}/login`,
      formPost({ number: "1".repeat(20000) }),
      env,
    );
    expect(res.status).toBe(413);
  });
});

describe("ledger safety", () => {
  it("stores the account number only as an HMAC", async () => {
    const { number } = await signup("mona");
    const row = await env.DB.prepare("SELECT number_hmac FROM users WHERE handle = ?")
      .bind("mona")
      .first<{ number_hmac: string }>();
    expect(row?.number_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.number_hmac).not.toContain(number);
  });
});
