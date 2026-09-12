import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import app from "../src/index";
import { PAGE_SIZE } from "../src/routes/timeline";
import { xmlEscape } from "../src/routes/feeds";
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

const ADMIN = env.ADMIN_HANDLE;
let adminCookie: string | null = null;
async function admin(): Promise<string> {
  if (!adminCookie) adminCookie = (await publisher(ADMIN)).cookie;
  return adminCookie;
}

describe("author pages", () => {
  it("shows only that author's posts", async () => {
    const mine = await publisher("author_mine");
    const theirs = await publisher("author_theirs");
    await publish(mine.cookie, "a line of my own");
    await publish(theirs.cookie, "a line of someone else's");

    const res = await app.request(`${ORIGIN}/@author_mine`, undefined, env);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("a line of my own");
    expect(body).not.toContain("a line of someone else");
  });

  it("is reachable from a post", async () => {
    const { cookie } = await publisher("linked_author");
    const { id } = await publish(cookie, "click through to me");
    const body = await (await app.request(`${ORIGIN}/p/${id}`, undefined, env)).text();
    expect(body).toContain('href="/@linked_author"');
  });

  it("404s for a handle nobody holds", async () => {
    const res = await app.request(`${ORIGIN}/@nobody_at_all`, undefined, env);
    expect(res.status).toBe(404);
  });

  // On a page already filtered to one person, a placeholder would announce that
  // this author in particular had something taken down.
  it("leaves a hidden post out rather than flagging it", async () => {
    const mod = await admin();
    const { cookie } = await publisher("author_hidden");
    const { id } = await publish(cookie, "this one gets pulled");
    await app.request(
      `${ORIGIN}/admin/posts/${id}`,
      formPost({ hidden: "1" }, { cookie: mod }),
      env,
    );
    const body = await (await app.request(`${ORIGIN}/@author_hidden`, undefined, env)).text();
    expect(body).not.toContain("this one gets pulled");
    expect(body).not.toContain("entry hidden");
  });
});

describe("tag pages", () => {
  it("collects posts carrying the tag, whoever wrote them", async () => {
    const one = await publisher("tagger_one");
    const two = await publisher("tagger_two");
    await publish(one.cookie, "first on the subject", "shared_tag");
    await publish(two.cookie, "second on the subject", "shared_tag, other");

    const body = await (await app.request(`${ORIGIN}/tag/shared_tag`, undefined, env)).text();
    expect(body).toContain("first on the subject");
    expect(body).toContain("second on the subject");
  });

  it("is reachable from a post", async () => {
    const { cookie } = await publisher("tag_linker");
    const { id } = await publish(cookie, "tagged up", "clickable");
    const body = await (await app.request(`${ORIGIN}/p/${id}`, undefined, env)).text();
    expect(body).toContain('href="/tag/clickable"');
  });

  it("shows an empty state for a tag nobody used", async () => {
    const res = await app.request(`${ORIGIN}/tag/nothing_here`, undefined, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Nothing tagged this yet");
  });
});

describe("paging", () => {
  it("cuts the page at the limit and offers the next one", async () => {
    // Each writer may publish once a minute, so a page's worth needs a writer each.
    const writers = await Promise.all(
      Array.from({ length: PAGE_SIZE + 1 }, (_, n) => publisher(`pager_${n}`)),
    );
    for (const w of writers) await publish(w.cookie, `paged entry from ${w.id.slice(0, 8)}`);

    const first = await (await app.request(`${ORIGIN}/`, undefined, env)).text();
    const shown = first.match(/class="excerpt"/g) ?? [];
    expect(shown.length).toBeLessThanOrEqual(PAGE_SIZE);
    expect(first).toContain("before=");

    const cursor = /before=(\d+)/.exec(first)![1];
    const second = await app.request(`${ORIGIN}/?before=${cursor}`, undefined, env);
    expect(second.status).toBe(200);
    expect(await second.text()).toContain('class="timeline"');
  });

  it("ignores a cursor that is not a positive whole number", async () => {
    for (const bad of ["abc", "-3", "1.5", ""]) {
      const res = await app.request(`${ORIGIN}/?before=${bad}`, undefined, env);
      expect(res.status, bad).toBe(200);
    }
  });
});

describe("feeds", () => {
  it("serves the global feed as RSS", async () => {
    const { cookie } = await publisher("feed_writer");
    await publish(cookie, "an entry for the feed");
    const res = await app.request(`${ORIGIN}/feed.xml`, undefined, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/rss+xml");
    const xml = await res.text();
    expect(xml).toContain("<?xml version");
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain("an entry for the feed");
    expect(xml).toContain("<guid");
  });

  it("is cached, unlike every page that shows a handle", async () => {
    const feed = await app.request(`${ORIGIN}/feed.xml`, undefined, env);
    expect(feed.headers.get("cache-control")).toContain("max-age");
    const timeline = await app.request(`${ORIGIN}/`, undefined, env);
    expect(timeline.headers.get("cache-control")).toBe("private, no-store");
  });

  it("serves a feed per author and per tag", async () => {
    const { cookie } = await publisher("feed_scoped");
    await publish(cookie, "scoped to one writer", "feedtag");

    const byAuthor = await (
      await app.request(`${ORIGIN}/@feed_scoped/feed.xml`, undefined, env)
    ).text();
    expect(byAuthor).toContain("scoped to one writer");

    const byTag = await (
      await app.request(`${ORIGIN}/tag/feedtag/feed.xml`, undefined, env)
    ).text();
    expect(byTag).toContain("scoped to one writer");
  });

  it("keeps hidden entries out of the feed entirely", async () => {
    const mod = await admin();
    const { cookie } = await publisher("feed_hidden");
    const { id } = await publish(cookie, "pulled from the feed");
    await app.request(
      `${ORIGIN}/admin/posts/${id}`,
      formPost({ hidden: "1" }, { cookie: mod }),
      env,
    );
    const xml = await (await app.request(`${ORIGIN}/feed.xml`, undefined, env)).text();
    expect(xml).not.toContain("pulled from the feed");
    expect(xml).not.toContain("entry hidden");
  });

  it("escapes markup so a post cannot break the document", async () => {
    const { cookie } = await publisher("feed_xml");
    await publish(cookie, "angle < brackets & ampersands ]]> in a post");
    const xml = await (await app.request(`${ORIGIN}/feed.xml`, undefined, env)).text();
    expect(xml).toContain("&lt;");
    expect(xml).toContain("&amp;");
    expect(xml).not.toContain("]]>");
  });

  it("escapes the five characters XML cares about", () => {
    expect(xmlEscape(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;",
    );
  });
});
