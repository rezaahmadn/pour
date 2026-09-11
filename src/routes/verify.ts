import { Hono } from "hono";
import { html } from "hono/html";
import type { AppEnv } from "../env";
import { GENESIS_HASH, computeHash } from "../post";
import { page } from "../layout";

/** Above this, walking the whole chain in one request stops being reasonable. */
export const VERIFY_LIMIT = 5000;

export type ChainReport =
  | { ok: true; entries: number }
  | { ok: false; entries: number; problem: string; at: string | null };

type Row = {
  id: string;
  user_id: string;
  body: string;
  created_at: number;
  prev_hash: string;
  hash: string;
  image_hashes: string | null;
};

/**
 * Walks the chain from genesis and recomputes every link.
 *
 * A hidden post is still verified in full: hiding takes it out of view, it does
 * not take it out of the ledger, so the body is still on disk and still hashed.
 * That is the whole point of hiding rather than deleting.
 */
export async function verifyChain(db: D1Database): Promise<ChainReport> {
  const { results } = await db
    .prepare(
      "SELECT posts.id AS id, posts.user_id AS user_id, posts.body AS body, " +
        "posts.created_at AS created_at, posts.prev_hash AS prev_hash, posts.hash AS hash, " +
        "(SELECT group_concat(sha256) FROM (SELECT sha256 FROM images " +
        "  WHERE images.post_id = posts.id ORDER BY created_at, id)) AS image_hashes " +
        "FROM posts ORDER BY posts.rowid LIMIT ?",
    )
    .bind(VERIFY_LIMIT)
    .all<Row>();

  const byParent = new Map<string, Row>();
  for (const row of results) {
    if (byParent.has(row.prev_hash)) {
      return {
        ok: false,
        entries: 0,
        problem: "Two entries claim the same parent.",
        at: row.id,
      };
    }
    byParent.set(row.prev_hash, row);
  }

  let cursor = GENESIS_HASH;
  let entries = 0;
  while (byParent.has(cursor)) {
    const row = byParent.get(cursor)!;
    const images = row.image_hashes ? row.image_hashes.split(",") : [];
    const expected = await computeHash(
      row.prev_hash,
      row.user_id,
      row.body,
      row.created_at,
      images,
    );
    if (expected !== row.hash) {
      return { ok: false, entries, problem: "An entry's contents no longer match its hash.", at: row.id };
    }
    entries += 1;
    cursor = row.hash;
  }

  if (entries !== results.length) {
    return {
      ok: false,
      entries,
      problem: `${results.length - entries} entries are not reachable from the start of the chain.`,
      at: null,
    };
  }
  return { ok: true, entries };
}

export const verifyRoutes = new Hono<AppEnv>();

verifyRoutes.get("/verify", async (c) => {
  const report = await verifyChain(c.env.DB);
  const body = report.ok
    ? html`<p class="verdict ok">Chain verified.</p>
        <p>
          ${report.entries} ${report.entries === 1 ? "entry" : "entries"}, each one linked to the
          one before it, every hash recomputed from the entry it covers.
        </p>`
    : html`<p class="verdict bad">Chain broken.</p>
        <p>${report.problem}</p>
        ${report.at ? html`<p class="note">First problem at entry ${report.at}.</p>` : ""}
        <p class="note">${report.entries} entries verified before the break.</p>`;

  return c.html(
    page({
      title: "verify",
      user: c.get("user"),
      body: html`<h1>verify</h1>
        <p>
          Every post records the hash of the post before it. Recomputing them in order proves
          that nothing was altered, and that nothing was removed from the middle. Hidden posts
          are still checked: hiding removes a post from view, not from the record.
        </p>
        <p class="note">
          What this cannot prove on its own: that the most recent entries were not simply cut
          from the end. A chain read only from inside itself has no way to know how long it
          should be. Publishing the latest hash somewhere outside would close that gap.
        </p>
        ${body}`,
    }),
    report.ok ? 200 : 500,
  );
});
