import { sha256Hex } from "./crypto";

/** The parent of the very first post. A fixed, known value so the chain has a root. */
export const GENESIS_HASH = "0".repeat(64);

/** The PRD sets no length limit by policy; this only keeps a row inside D1's limits. */
export const MAX_BODY_BYTES = 1024 * 1024;

export const MAX_TAGS = 5;
export const TAG_RE = /^[a-z0-9_-]{1,24}$/;

/** One link in the chain: sha256 over the parent and this post's own fields. */
export function computeHash(
  prevHash: string,
  userId: string,
  body: string,
  createdAt: number,
  imageHashes: string[] = [],
): Promise<string> {
  // Image digests are appended rather than mixed in, so a post carrying no
  // pictures hashes to exactly what it did before images existed. That keeps
  // every entry already in the chain verifiable.
  return sha256Hex(`${prevHash}${userId}${body}${createdAt}${imageHashes.join("")}`);
}

/** Trims trailing whitespace and rejects an empty or oversized body. */
export function normalizeBody(input: string): { body: string } | { error: string } {
  const body = input.replace(/\s+$/, "");
  if (!body) return { error: "Write something first." };
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
    return { error: "That post is too long to store. Trim it and try again." };
  }
  return { body };
}

/**
 * Free tags, comma separated. Lowercased, deduplicated, order preserved.
 * Returns an error rather than silently dropping a tag the writer typed, so a
 * typo does not vanish without explanation.
 */
export function parseTags(input: string): { tags: string[] } | { error: string } {
  const seen = new Set<string>();
  for (const raw of input.split(",")) {
    const tag = raw.trim().toLowerCase();
    if (!tag) continue;
    if (!TAG_RE.test(tag)) {
      return { error: "Tags can use lowercase letters, digits, hyphen and underscore." };
    }
    seen.add(tag);
  }
  if (seen.size > MAX_TAGS) return { error: `Up to ${MAX_TAGS} tags.` };
  return { tags: [...seen] };
}

/**
 * True when this error is a UNIQUE violation on the given `table.column`.
 *
 * SQLite words it as "UNIQUE constraint failed: posts.prev_hash", naming the
 * column, not the index. D1 also nests the original under `cause`, so both are
 * checked. Matching the wrong string here silently turns a recoverable conflict
 * into a 500, which is exactly what happened before a test caught it.
 */
export function isUniqueViolation(err: unknown, column: string): boolean {
  const needle = `UNIQUE constraint failed: ${column}`;
  if (String(err).includes(needle)) return true;
  const cause = (err as { cause?: unknown })?.cause;
  return cause !== undefined && String(cause).includes(needle);
}

/**
 * A plain-text opening for the timeline. Strips the common markdown marks so the
 * excerpt reads as prose rather than as source. The result is interpolated through
 * the escaping template like any other text, so it is not a sanitiser and does not
 * need to be one.
 */
export function excerptOf(body: string, limit = 180): string {
  const flat = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>)\s*/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/^\s{0,3}\d+\.\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > limit ? `${flat.slice(0, limit).trimEnd()}\u2026` : flat;
}
