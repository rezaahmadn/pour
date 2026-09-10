import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import app, { excerpt } from "../src/index";
import { GENESIS_HASH } from "../src/post";
import { POSTS_PER_DAY } from "../src/routes/write";
import {
  ORIGIN,
  assertNoPendingMocks,
  clearPostCooldown,
  formPost,
  installFetchMock,
  publish,
  publisher,
  uninstallFetchMock,
  walkChain,
} from "./helpers";

beforeAll(() => installFetchMock());
afterAll(() => uninstallFetchMock());
afterEach(() => assertNoPendingMocks());

describe("GET /write", () => {
  it("redirects an anonymous visitor to login", async () => {
    const res = await app.request(`${ORIGIN}/write`, undefined, env);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("shows the editor to a signed-in writer", async () => {
    const { cookie } = await publisher("editor_view");
    const res = await app.request(`${ORIGIN}/write`, { headers: { cookie } }, env);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('name="body"');
    expect(body).toContain('name="tags"');
    expect(body).toContain("cannot edit or delete");
  });
});

describe("publishing", () => {
  it("stores the post and serves it at its own address", async () => {
    const { cookie } = await publisher("first_post");
    const { status, id } = await publish(cookie, "Hello from **pour**.", "intro, testing");
    expect(status).toBe(302);
    expect(id).toBeTruthy();

    const res = await app.request(`${ORIGIN}/p/${id}`, undefined, env);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<strong>pour</strong>");
    expect(body).toContain("@first_post");
    expect(body).toContain("#intro");
    expect(body).toContain("#testing");
  });

  it("puts the post on the timeline", async () => {
    const { cookie } = await publisher("on_timeline");
    await publish(cookie, "A line that should show up on the front page.");
    const res = await app.request(`${ORIGIN}/`, undefined, env);
    const body = await res.text();
    expect(body).toContain("should show up on the front page");
    expect(body).toContain("@on_timeline");
  });

  it("returns 404 for a post that does not exist", async () => {
    const res = await app.request(`${ORIGIN}/p/nope`, undefined, env);
    expect(res.status).toBe(404);
  });

  it("rejects an empty body", async () => {
    const { cookie } = await publisher("empty_body");
    const { status, res } = await publish(cookie, "   \n  ");
    expect(status).toBe(400);
    expect(await res.text()).toContain("Write something first");
  });

  it("rejects a body over the storage cap", async () => {
    const { cookie } = await publisher("huge_body");
    const { status, res } = await publish(cookie, "x".repeat(1024 * 1024 + 1));
    expect(status).toBe(400);
    expect(await res.text()).toContain("too long to store");
  });

  it("rejects a malformed tag rather than silently dropping it", async () => {
    const { cookie } = await publisher("bad_tag");
    const { status, res } = await publish(cookie, "body", "fine, Not A Tag!");
    expect(status).toBe(400);
    expect(await res.text()).toContain("Tags can use");
  });

  it("keeps the draft in the form when it rejects the post", async () => {
    const { cookie } = await publisher("keeps_draft");
    const { res } = await publish(cookie, "worth keeping", "bad tag!");
    expect(await res.text()).toContain("worth keeping");
  });
});

describe("rendering is safe", () => {
  it("escapes raw HTML in a body instead of running it", async () => {
    const { cookie } = await publisher("xss_html");
    const { id } = await publish(cookie, "before <script>alert(1)</script> after");
    const body = await (await app.request(`${ORIGIN}/p/${id}`, undefined, env)).text();
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("&lt;script&gt;");
  });

  it("drops a javascript: link", async () => {
    const { cookie } = await publisher("xss_link");
    const { id } = await publish(cookie, "[tap me](javascript:alert(1))");
    const body = await (await app.request(`${ORIGIN}/p/${id}`, undefined, env)).text();
    expect(body).not.toContain("javascript:");
    expect(body).toContain("tap me");
  });

  it("escapes HTML in the timeline excerpt too", async () => {
    const { cookie } = await publisher("xss_excerpt");
    await publish(cookie, "<img src=x onerror=alert(1)>");
    const body = await (await app.request(`${ORIGIN}/`, undefined, env)).text();
    expect(body).not.toContain("<img src=x");
    expect(body).toContain("&lt;img");
  });
});

describe("the hash chain", () => {
  it("roots the first post at genesis and links each one to the last", async () => {
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM posts").first<{ n: number }>();
    const { cookie, id: userId } = await publisher("chain_links");
    await publish(cookie, "one");
    await clearPostCooldown(userId);
    await publish(cookie, "two");

    const { results } = await env.DB.prepare(
      "SELECT hash, prev_hash FROM posts ORDER BY rowid",
    ).all<{ hash: string; prev_hash: string }>();
    expect(results.length).toBe((before?.n ?? 0) + 2);
    expect(results[0].prev_hash).toBe(GENESIS_HASH);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].prev_hash, `link ${i}`).toBe(results[i - 1].hash);
    }
  });

  // The PRD's success signal for this phase. A unique index on prev_hash is what
  // makes a second branch impossible to store; the loser re-reads the head.
  it("stays a single chain when publishes land together", async () => {
    const writers = await Promise.all([1, 2, 3, 4].map((n) => publisher(`racer_${n}`)));
    const results = await Promise.all(
      writers.map((w, n) => publish(w.cookie, `racing post ${n}`)),
    );
    expect(results.every((r) => r.status === 302)).toBe(true);

    const order = await walkChain();
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM posts").first<{ n: number }>();
    expect(order.length).toBe(rows?.n ?? -1);
    expect(new Set(order).size).toBe(order.length);
  });

  it("refuses to store a second post claiming the same parent", async () => {
    const { cookie } = await publisher("fork_attempt");
    await publish(cookie, "legitimate");
    const head = await env.DB.prepare("SELECT prev_hash FROM posts ORDER BY rowid DESC LIMIT 1")
      .first<{ prev_hash: string }>();
    await expect(
      env.DB.prepare(
        "INSERT INTO posts (id, user_id, body, created_at, prev_hash, hash, hidden) " +
          "VALUES ('forged', 'someone', 'forged', 1, ?, 'forgedhash', 0)",
      )
        .bind(head!.prev_hash)
        .run(),
    ).rejects.toThrow();
  });
});

describe("posting limits", () => {
  it("holds a new account back for its first ten minutes", async () => {
    const { cookie } = await publisher("too_new");
    await env.DB.prepare("UPDATE users SET created_at = ? WHERE handle = ?")
      .bind(Math.floor(Date.now() / 1000) - 60, "too_new")
      .run();
    const { status, res } = await publish(cookie, "eager");
    expect(status).toBe(429);
    expect(await res.text()).toContain("before posting");
  });

  it("allows one post a minute", async () => {
    const { cookie } = await publisher("one_a_minute");
    expect((await publish(cookie, "first")).status).toBe(302);
    const second = await publish(cookie, "second, too soon");
    expect(second.status).toBe(429);
    expect(await second.res.text()).toContain("One post a minute");
  });

  it("stops at the daily limit", async () => {
    const { cookie, id: userId } = await publisher("daily_cap");
    const now = Math.floor(Date.now() / 1000);
    // Seeded directly. Publishing them for real would take most of an hour under
    // the one-a-minute rule.
    for (let i = 0; i < POSTS_PER_DAY; i++) {
      await env.DB.prepare(
        "INSERT INTO posts (id, user_id, body, created_at, prev_hash, hash, hidden) " +
          "VALUES (?, ?, 'seeded', ?, ?, ?, 0)",
      )
        .bind(
          `seed-${userId}-${i}`,
          userId,
          now - 3600,
          `seedprev-${userId}-${i}`,
          `seedhash-${userId}-${i}`,
        )
        .run();
    }
    const { status, res } = await publish(cookie, "one too many");
    expect(status).toBe(429);
    expect(await res.text()).toContain("posts today");
  });

  it("refuses to publish from a frozen account", async () => {
    const { cookie } = await publisher("frozen_out");
    await env.DB.prepare("UPDATE users SET frozen = 1 WHERE handle = ?").bind("frozen_out").run();
    const { status, res } = await publish(cookie, "still talking");
    expect(status).toBe(403);
    expect(await res.text()).toContain("cannot publish");
  });
});

describe("the ledger is append only", () => {
  it("hides a hidden post from its own page and the timeline", async () => {
    const { cookie } = await publisher("hidden_post");
    const { id } = await publish(cookie, "this will be hidden away");
    await env.DB.prepare("UPDATE posts SET hidden = 1 WHERE id = ?").bind(id).run();

    expect((await app.request(`${ORIGIN}/p/${id}`, undefined, env)).status).toBe(404);
    const timelineRes = await app.request(`${ORIGIN}/`, undefined, env);
    const timeline = await timelineRes.text();
    expect(timeline).not.toContain("this will be hidden away");
  });

  it("exposes no route that edits or deletes a post", async () => {
    const { cookie } = await publisher("no_edit");
    const { id } = await publish(cookie, "permanent");
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const res = await app.request(
        `${ORIGIN}/p/${id}`,
        { method, headers: { cookie, origin: ORIGIN } },
        env,
      );
      expect(res.status, method).toBe(404);
    }
    const stillThere = await app.request(`${ORIGIN}/p/${id}`, undefined, env);
    expect(stillThere.status).toBe(200);
  });
});

describe("csrf still applies to publishing", () => {
  it("rejects a publish with no Origin", async () => {
    const { cookie } = await publisher("csrf_publish");
    const res = await app.request(
      `${ORIGIN}/write`,
      formPost({ body: "sneaky" }, { cookie, origin: null }),
      env,
    );
    expect(res.status).toBe(403);
  });
});

describe("timeline excerpts", () => {
  it("reads as prose rather than as markdown source", () => {
    expect(excerpt("# Hello\n\nThis is *markdown* with a [link](https://example.com).")).toBe(
      "Hello This is markdown with a link.",
    );
    expect(excerpt("- one\n- two")).toBe("one two");
    expect(excerpt("> quoted thought")).toBe("quoted thought");
    expect(excerpt("here is ```\nconst x = 1\n``` code")).toBe("here is code");
  });

  it("trims to the limit and marks the cut", () => {
    const out = excerpt("word ".repeat(80), 20);
    expect(out.length).toBeLessThanOrEqual(21);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("the editor carries the autosave hooks", () => {
  it("marks the form and loads the script only on the editor", async () => {
    const { cookie } = await publisher("autosave_hooks");
    const write = await (await app.request(`${ORIGIN}/write`, { headers: { cookie } }, env)).text();
    expect(write).toContain("data-autosave");
    expect(write).toContain('src="/editor.js"');
    expect(write).toContain('id="draft-status"');

    // Every other page stays script free, which is the point of the design.
    const timeline = await (await app.request(`${ORIGIN}/`, undefined, env)).text();
    expect(timeline).not.toContain("editor.js");
    const login = await (await app.request(`${ORIGIN}/login`, undefined, env)).text();
    expect(login).not.toContain("editor.js");
  });

  it("keeps the hooks on a rejected publish, so the draft is still held", async () => {
    const { cookie } = await publisher("autosave_reject");
    const { res } = await publish(cookie, "kept text", "bad tag!");
    const body = await res.text();
    expect(body).toContain("data-autosave");
    expect(body).toContain('src="/editor.js"');
    expect(body).toContain("kept text");
  });
});
