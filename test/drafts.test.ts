import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import app from "../src/index";
import { signupIsOpen } from "../src/routes/auth";
import {
  ORIGIN,
  assertNoPendingMocks,
  formPost,
  installFetchMock,
  mockTurnstile,
  publish,
  publisher,
  uninstallFetchMock,
} from "./helpers";

beforeAll(() => installFetchMock());
afterAll(() => uninstallFetchMock());
afterEach(() => assertNoPendingMocks());

function saveDraft(cookie: string, body: string, tags = "") {
  return app.request(`${ORIGIN}/draft`, formPost({ body, tags }, { cookie }), env);
}

describe("server-side drafts", () => {
  it("turns away anyone not signed in", async () => {
    const res = await app.request(`${ORIGIN}/draft`, formPost({ body: "hello" }), env);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("stores a draft and hands it back with the editor", async () => {
    const { cookie } = await publisher("draft_sync");
    const res = await saveDraft(cookie, "half a thought", "notes");
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { updatedAt: number };
    expect(payload.updatedAt).toBeGreaterThan(0);

    // This is the whole point of the feature: another device asks for the editor
    // and the words are already in the page.
    const editor = await (
      await app.request(`${ORIGIN}/write`, { headers: { cookie } }, env)
    ).text();
    expect(editor).toContain("half a thought");
    expect(editor).toContain('data-saved-tags="notes"');
    expect(editor).toContain("data-saved-at=");
  });

  it("keeps one draft per person, replacing the last", async () => {
    const { cookie } = await publisher("draft_replace");
    await saveDraft(cookie, "first version");
    await saveDraft(cookie, "second version");
    const { results } = await env.DB.prepare(
      "SELECT body FROM drafts WHERE user_id = " +
        "(SELECT id FROM users WHERE handle = 'draft_replace')",
    ).all<{ body: string }>();
    expect(results).toHaveLength(1);
    expect(results[0].body).toBe("second version");
  });

  it("does not let one person read another's draft", async () => {
    const mine = await publisher("draft_mine");
    const theirs = await publisher("draft_theirs");
    await saveDraft(mine.cookie, "my private half-thought");
    const editor = await (
      await app.request(`${ORIGIN}/write`, { headers: { cookie: theirs.cookie } }, env)
    ).text();
    expect(editor).not.toContain("my private half-thought");
  });

  it("clears the draft when the body is emptied", async () => {
    const { cookie } = await publisher("draft_cleared");
    await saveDraft(cookie, "something");
    await saveDraft(cookie, "   ");
    const row = await env.DB.prepare(
      "SELECT body FROM drafts WHERE user_id = " +
        "(SELECT id FROM users WHERE handle = 'draft_cleared')",
    ).first();
    expect(row).toBeNull();
  });

  it("clears the draft once the post is published", async () => {
    const { cookie } = await publisher("draft_published");
    await saveDraft(cookie, "about to become a post");
    const { status } = await publish(cookie, "about to become a post");
    expect(status).toBe(302);
    const row = await env.DB.prepare(
      "SELECT body FROM drafts WHERE user_id = " +
        "(SELECT id FROM users WHERE handle = 'draft_published')",
    ).first();
    expect(row).toBeNull();
  });

  it("refuses a draft larger than a post may be", async () => {
    const { cookie } = await publisher("draft_huge");
    const res = await saveDraft(cookie, "x".repeat(1024 * 1024 + 1));
    expect(res.status).toBe(400);
  });

  it("rejects a cross-site draft post", async () => {
    const { cookie } = await publisher("draft_csrf");
    const res = await app.request(
      `${ORIGIN}/draft`,
      formPost({ body: "sneaky" }, { cookie, origin: "https://evil.example" }),
      env,
    );
    expect(res.status).toBe(403);
  });
});

describe("the signup gate", () => {
  it("treats a missing setting as open, so nothing locks by accident", () => {
    expect(signupIsOpen({})).toBe(true);
    expect(signupIsOpen({ SIGNUP_OPEN: "true" })).toBe(true);
    expect(signupIsOpen({ SIGNUP_OPEN: "false" })).toBe(false);
    expect(signupIsOpen({ SIGNUP_OPEN: "FALSE" })).toBe(false);
  });

  it("asks for no code while signup is open", async () => {
    const body = await (await app.request(`${ORIGIN}/signup`, undefined, env)).text();
    expect(body).not.toContain('name="invite"');
    expect(body).not.toContain("Signup is closed");
  });

  it("asks for a code once it is closed", async () => {
    const closed = { ...env, SIGNUP_OPEN: "false" };
    const body = await (await app.request(`${ORIGIN}/signup`, undefined, closed)).text();
    expect(body).toContain('name="invite"');
    expect(body).toContain("Signup is closed");
  });

  it("turns away a wrong code without spending a Turnstile token", async () => {
    const closed = { ...env, SIGNUP_OPEN: "false" };
    // No mock is queued. assertNoPendingMocks would fail if Turnstile were reached.
    const res = await app.request(
      `${ORIGIN}/signup`,
      formPost({ handle: "gatecrash", invite: "wrong", "cf-turnstile-response": "tok" }),
      closed,
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("invite code is not right");
  });

  it("lets the right code through", async () => {
    const closed = { ...env, SIGNUP_OPEN: "false" };
    mockTurnstile(true);
    const res = await app.request(
      `${ORIGIN}/signup`,
      formPost({
        handle: "invited_in",
        invite: env.INVITE_CODE,
        "cf-turnstile-response": "tok",
      }),
      closed,
    );
    expect(res.status).toBe(201);
  });

  it("stays shut when it is closed but no code was ever configured", async () => {
    const closed = { ...env, SIGNUP_OPEN: "false", INVITE_CODE: "" };
    const res = await app.request(
      `${ORIGIN}/signup`,
      formPost({ handle: "nocode", invite: "", "cf-turnstile-response": "tok" }),
      closed,
    );
    expect(res.status).toBe(403);
  });
});
