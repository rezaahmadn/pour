import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { renderMarkdown } from "../markdown";
import { globalPosts, handlePosts, tagPosts, type FeedRow } from "./timeline";

export const FEED_SIZE = 30;

/** Escapes text for XML. Feeds are not HTML and the template helper does not apply. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function rfc822(seconds: number): string {
  return new Date(seconds * 1000).toUTCString();
}

export function buildFeed(opts: {
  origin: string;
  path: string;
  title: string;
  description: string;
  rows: FeedRow[];
}): string {
  const self = `${opts.origin}${opts.path}`;
  const items = opts.rows
    .map((row) => {
      const link = `${opts.origin}/p/${row.id}`;
      const title = row.body.replace(/\s+/g, " ").trim().slice(0, 70) || "Entry";
      return [
        "    <item>",
        `      <title>${xmlEscape(title)}</title>`,
        `      <link>${xmlEscape(link)}</link>`,
        `      <guid isPermaLink="true">${xmlEscape(link)}</guid>`,
        `      <pubDate>${rfc822(row.created_at)}</pubDate>`,
        `      <dc:creator>${xmlEscape(row.handle)}</dc:creator>`,
        `      <description>${xmlEscape(renderMarkdown(row.body))}</description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "  <channel>",
    `    <title>${xmlEscape(opts.title)}</title>`,
    `    <link>${xmlEscape(opts.origin)}</link>`,
    `    <description>${xmlEscape(opts.description)}</description>`,
    `    <atom:link href="${xmlEscape(self)}" rel="self" type="application/rss+xml" />`,
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

function respond(c: Context<AppEnv>, xml: string) {
  // Feeds carry no per-viewer content, so unlike every other page they are worth
  // caching. The header middleware leaves an explicit Cache-Control alone.
  c.header("Content-Type", "application/rss+xml; charset=utf-8");
  c.header("Cache-Control", "public, max-age=300");
  return c.body(xml);
}

export const feedRoutes = new Hono<AppEnv>();

feedRoutes.get("/feed.xml", async (c) => {
  const origin = new URL(c.req.url).origin;
  // Hidden entries are left out of feeds entirely. A reader cannot act on a
  // placeholder, and the timeline is where the record stays visibly continuous.
  const rows = (await globalPosts(c.env.DB, null, FEED_SIZE)).filter((r) => !r.hidden);
  return respond(
    c,
    buildFeed({
      origin,
      path: "/feed.xml",
      title: "pour",
      description: "A quiet place to write anything.",
      rows,
    }),
  );
});

feedRoutes.get("/:at{@[A-Za-z0-9_]+}/feed.xml", async (c) => {
  const handle = (c.req.param("at") ?? "").slice(1).toLowerCase();
  const origin = new URL(c.req.url).origin;
  const rows = await handlePosts(c.env.DB, handle, null, FEED_SIZE);
  return respond(
    c,
    buildFeed({
      origin,
      path: `/@${handle}/feed.xml`,
      title: `@${handle} on pour`,
      description: `Everything @${handle} has published.`,
      rows,
    }),
  );
});

feedRoutes.get("/tag/:tag/feed.xml", async (c) => {
  const tag = (c.req.param("tag") ?? "").toLowerCase();
  const origin = new URL(c.req.url).origin;
  const rows = await tagPosts(c.env.DB, tag, null, FEED_SIZE);
  return respond(
    c,
    buildFeed({
      origin,
      path: `/tag/${tag}/feed.xml`,
      title: `#${tag} on pour`,
      description: `Everything tagged #${tag}.`,
      rows,
    }),
  );
});
