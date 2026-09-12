import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import app from "../src/index";
import { verifyChain } from "../src/routes/verify";
import {
  ORIGIN,
  assertNoPendingMocks,
  formPost,
  installFetchMock,
  publish,
  publisher,
  uninstallFetchMock,
} from "./helpers";

beforeAll(() => installFetchMock());
afterAll(() => uninstallFetchMock());
afterEach(() => assertNoPendingMocks());

/** The admin is whichever handle the Worker environment names. */
const ADMIN = env.ADMIN_HANDLE;

let adminCookie: string | null = null;

/** The admin account is made once; signing up twice with one handle is a 409. */
async function admin(): Promise<string> {
  if (!adminCookie) adminCookie = (await publisher(ADMIN)).cookie;
  return adminCookie;
}

describe("who can reach the admin page", () => {
  it("hides it from anonymous visitors", async () => {
    const res = await app.request(`${ORIGIN}/admin`, undefined, env);
    expect(res.status).toBe(404);
  });

  it("hides it from an ordinary account", async () => {
    const { cookie } = await publisher("not_admin");
    const res = await app.request(`${ORIGIN}/admin`, { headers: { cookie } }, env);
    expect(res.status).toBe(404);
  });

  it("opens for the admin handle", async () => {
    const cookie = await admin();
    const res = await app.request(`${ORIGIN}/admin`, { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Posts");
    expect(body).toContain("Accounts");
  });
});

describe("hiding a post", () => {
  it("takes it out of view and leaves it in the record", async () => {
    const mod = await admin();
    const { cookie } = await publisher("gets_hidden");
    const { id } = await publish(cookie, "something that has to come down");

    const res = await app.request(
      `${ORIGIN}/admin/posts/${id}`,
      formPost({ hidden: "1" }, { cookie: mod }),
      env,
    );
    expect(res.status).toBe(302);

    const post = await app.request(`${ORIGIN}/p/${id}`, undefined, env);
    expect(post.status).toBe(410);
    expect(await post.text()).not.toContain("has to come down");

    const row = await env.DB.prepare("SELECT body, hidden FROM posts WHERE id = ?")
      .bind(id)
      .first<{ body: string; hidden: number }>();
    expect(row?.hidden).toBe(1);
    // Still on disk. Hiding is not deleting, which is what keeps the chain valid.
    expect(row?.body).toContain("has to come down");
  });

  it("can be undone", async () => {
    const mod = await admin();
    const { cookie } = await publisher("gets_unhidden");
    const { id } = await publish(cookie, "back into the light");
    await app.request(
      `${ORIGIN}/admin/posts/${id}`,
      formPost({ hidden: "1" }, { cookie: mod }),
      env,
    );
    await app.request(
      `${ORIGIN}/admin/posts/${id}`,
      formPost({ hidden: "0" }, { cookie: mod }),
      env,
    );
    const post = await app.request(`${ORIGIN}/p/${id}`, undefined, env);
    expect(post.status).toBe(200);
    expect(await post.text()).toContain("back into the light");
  });

  it("cannot be done by an ordinary account", async () => {
    const { cookie } = await publisher("would_be_mod");
    const { id } = await publish(cookie, "my own post");
    const res = await app.request(
      `${ORIGIN}/admin/posts/${id}`,
      formPost({ hidden: "1" }, { cookie }),
      env,
    );
    expect(res.status).toBe(404);
    const row = await env.DB.prepare("SELECT hidden FROM posts WHERE id = ?")
      .bind(id)
      .first<{ hidden: number }>();
    expect(row?.hidden).toBe(0);
  });
});

describe("freezing an account", () => {
  it("stops it publishing and leaves its posts standing", async () => {
    const mod = await admin();
    const { cookie } = await publisher("gets_frozen");
    const { id } = await publish(cookie, "written before the freeze");

    const res = await app.request(
      `${ORIGIN}/admin/users/gets_frozen`,
      formPost({ frozen: "1" }, { cookie: mod }),
      env,
    );
    expect(res.status).toBe(302);

    const attempt = await publish(cookie, "written after the freeze");
    expect(attempt.status).toBe(403);

    const earlier = await app.request(`${ORIGIN}/p/${id}`, undefined, env);
    expect(earlier.status).toBe(200);
    expect(await earlier.text()).toContain("written before the freeze");
  });

  it("can be undone", async () => {
    const mod = await admin();
    await publisher("gets_thawed");
    await app.request(
      `${ORIGIN}/admin/users/gets_thawed`,
      formPost({ frozen: "1" }, { cookie: mod }),
      env,
    );
    await app.request(
      `${ORIGIN}/admin/users/gets_thawed`,
      formPost({ frozen: "0" }, { cookie: mod }),
      env,
    );
    const row = await env.DB.prepare(
      "SELECT frozen FROM users WHERE handle = 'gets_thawed'",
    ).first<{ frozen: number }>();
    expect(row?.frozen).toBe(0);
  });
});

describe("verifying the chain", () => {
  it("reports OK over the posts that exist", async () => {
    const { cookie } = await publisher("verify_ok");
    await publish(cookie, "an entry to verify");
    const report = await verifyChain(env.DB);
    expect(report.ok).toBe(true);
    const res = await app.request(`${ORIGIN}/verify`, undefined, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Chain verified");
  });

  it("still verifies once a post is hidden", async () => {
    const mod = await admin();
    const { cookie } = await publisher("verify_hidden");
    const { id } = await publish(cookie, "hidden but still counted");
    await app.request(
      `${ORIGIN}/admin/posts/${id}`,
      formPost({ hidden: "1" }, { cookie: mod }),
      env,
    );
    const report = await verifyChain(env.DB);
    expect(report.ok).toBe(true);
  });

  it("catches a body edited behind the chain's back", async () => {
    const { cookie } = await publisher("verify_tamper");
    const { id } = await publish(cookie, "the original words");
    await env.DB.prepare("UPDATE posts SET body = 'swapped out' WHERE id = ?").bind(id).run();

    const report = await verifyChain(env.DB);
    expect(report.ok).toBe(false);
    if (!report.ok) {
      expect(report.problem).toContain("no longer match");
      expect(report.at).toBe(id);
    }

    const res = await app.request(`${ORIGIN}/verify`, undefined, env);
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("Chain broken");

    // Put it back, so the rest of this file sees an intact chain.
    await env.DB.prepare("UPDATE posts SET body = 'the original words' WHERE id = ?")
      .bind(id)
      .run();
    expect((await verifyChain(env.DB)).ok).toBe(true);
  });

  it("catches an entry removed from the middle", async () => {
    const first = await publisher("verify_gap_a");
    const second = await publisher("verify_gap_b");
    const { id } = await publish(first.cookie, "about to vanish");
    // A later entry chains off it, so removing it leaves everything after it stranded.
    await publish(second.cookie, "the entry that follows it");

    const row = await env.DB.prepare(
      "SELECT user_id, body, created_at, prev_hash, hash FROM posts WHERE id = ?",
    )
      .bind(id)
      .first<{
        user_id: string;
        body: string;
        created_at: number;
        prev_hash: string;
        hash: string;
      }>();
    await env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id).run();

    const report = await verifyChain(env.DB);
    expect(report.ok).toBe(false);
    if (!report.ok) expect(report.problem).toContain("not reachable");

    // Restore it exactly. Nothing in the app itself can delete a post; this only
    // proves the check would notice if the database were edited from outside.
    await env.DB.prepare(
      "INSERT INTO posts (id, user_id, body, created_at, prev_hash, hash, hidden) " +
        "VALUES (?, ?, ?, ?, ?, ?, 0)",
    )
      .bind(id, row!.user_id, row!.body, row!.created_at, row!.prev_hash, row!.hash)
      .run();
    expect((await verifyChain(env.DB)).ok).toBe(true);
  });

  // Worth stating plainly: a chain proves nothing was altered or removed from the
  // middle, but on its own it cannot prove entries were not lopped off the end.
  it("says out loud that it cannot detect truncation", async () => {
    const res = await app.request(`${ORIGIN}/verify`, undefined, env);
    expect(await res.text()).toContain("most recent entries");
  });
});
