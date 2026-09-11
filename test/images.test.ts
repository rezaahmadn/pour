import { env } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import app from "../src/index";
import { MAX_IMAGES_PER_POST, looksLikeImage } from "../src/images";
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

const ADMIN = env.ADMIN_HANDLE;
let adminCookie: string | null = null;
async function admin(): Promise<string> {
  if (!adminCookie) adminCookie = (await publisher(ADMIN)).cookie;
  return adminCookie;
}

/** A real PNG header followed by filler. Enough for the magic-byte check. */
function png(size = 128): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
}

function jpeg(size = 128): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff], 0);
  return bytes;
}

function upload(cookie: string, bytes: Uint8Array, type: string, name = "image.png") {
  const form = new FormData();
  form.append("file", new File([bytes as BufferSource], name, { type }));
  return app.request(
    `${ORIGIN}/upload`,
    { method: "POST", headers: { cookie, origin: ORIGIN }, body: form },
    env,
  );
}

describe("uploading a picture", () => {
  it("turns away anyone not signed in", async () => {
    const form = new FormData();
    form.append("file", new File([png() as BufferSource], "a.png", { type: "image/png" }));
    const res = await app.request(
      `${ORIGIN}/upload`,
      { method: "POST", headers: { origin: ORIGIN }, body: form },
      env,
    );
    expect(res.status).toBe(302);
  });

  it("stores the bytes and hands back markdown to paste in", async () => {
    const { cookie } = await publisher("img_upload");
    const res = await upload(cookie, png(), "image/png");
    expect(res.status).toBe(201);
    const data = (await res.json()) as { url: string; markdown: string };
    expect(data.url).toMatch(/^\/i\/[0-9a-f]{32}\.png$/);
    expect(data.markdown).toBe(`![](${data.url})`);

    const served = await app.request(`${ORIGIN}${data.url}`, undefined, env);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("cache-control")).toContain("immutable");
  });

  // The browser re-encodes through a canvas, which is what drops EXIF. A file
  // that did not come that way still has its GPS in it, so it is refused.
  it("refuses a format a canvas never produces", async () => {
    const { cookie } = await publisher("img_heic");
    const res = await upload(cookie, png(), "image/heic", "photo.heic");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("not accepted");
  });

  it("refuses a file lying about what it is", async () => {
    const { cookie } = await publisher("img_liar");
    const notAnImage = new TextEncoder().encode("<?php echo 'hello'; ?>".padEnd(128, " "));
    const res = await upload(cookie, notAnImage, "image/png");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("not the image it claims");
  });

  it("checks magic bytes rather than the declared type", () => {
    expect(looksLikeImage(png(), "image/png")).toBe(true);
    expect(looksLikeImage(jpeg(), "image/jpeg")).toBe(true);
    expect(looksLikeImage(png(), "image/jpeg")).toBe(false);
    expect(looksLikeImage(new Uint8Array(32), "image/png")).toBe(false);
  });

  it("caps how many pictures one post may carry", async () => {
    const { cookie } = await publisher("img_many");
    for (let i = 0; i < MAX_IMAGES_PER_POST; i++) {
      expect((await upload(cookie, png(), "image/png")).status, `upload ${i}`).toBe(201);
    }
    const tooMany = await upload(cookie, png(), "image/png");
    expect(tooMany.status).toBe(429);
  });

  it("returns 404 for a key that was never issued", async () => {
    const res = await app.request(`${ORIGIN}/i/deadbeef.webp`, undefined, env);
    expect(res.status).toBe(404);
  });
});

describe("pictures and the ledger", () => {
  it("attaches pending uploads to the post that follows them", async () => {
    const { cookie, id: userId } = await publisher("img_claim");
    await upload(cookie, png(), "image/png");
    const { id } = await publish(cookie, "a post with a picture");

    const row = await env.DB.prepare("SELECT post_id FROM images WHERE user_id = ?")
      .bind(userId)
      .first<{ post_id: string }>();
    expect(row?.post_id).toBe(id);
  });

  it("folds the picture's digest into the post hash", async () => {
    const { cookie } = await publisher("img_hashed");
    await upload(cookie, jpeg(), "image/jpeg", "photo.jpg");
    await publish(cookie, "hashed together with its picture");
    // verifyChain recomputes with the image digests; a mismatch would fail here.
    expect((await verifyChain(env.DB)).ok).toBe(true);
  });

  // A post with no pictures must hash exactly as it did before images existed,
  // or every entry already in the chain would read as broken.
  it("leaves a post without pictures hashing as before", async () => {
    const { cookie } = await publisher("img_none");
    await publish(cookie, "no pictures here");
    expect((await verifyChain(env.DB)).ok).toBe(true);
  });

  it("notices a picture swapped out behind the chain's back", async () => {
    const { cookie } = await publisher("img_tamper");
    await upload(cookie, png(), "image/png");
    const { id } = await publish(cookie, "the picture matters");
    expect((await verifyChain(env.DB)).ok).toBe(true);

    const before = await env.DB.prepare("SELECT sha256 FROM images WHERE post_id = ?")
      .bind(id)
      .first<{ sha256: string }>();
    await env.DB.prepare("UPDATE images SET sha256 = ? WHERE post_id = ?")
      .bind("f".repeat(64), id)
      .run();
    expect((await verifyChain(env.DB)).ok).toBe(false);

    // Put it back so the rest of this file sees an intact chain.
    await env.DB.prepare("UPDATE images SET sha256 = ? WHERE post_id = ?")
      .bind(before!.sha256, id)
      .run();
    expect((await verifyChain(env.DB)).ok).toBe(true);
  });
});

describe("hiding a post hides its pictures", () => {
  it("withholds the image once the post is hidden", async () => {
    const mod = await admin();
    const { cookie } = await publisher("img_hidden");
    const uploaded = (await (await upload(cookie, png(), "image/png")).json()) as { url: string };
    const { id } = await publish(cookie, "a post that comes down");

    expect((await app.request(`${ORIGIN}${uploaded.url}`, undefined, env)).status).toBe(200);

    await app.request(
      `${ORIGIN}/admin/posts/${id}`,
      formPost({ hidden: "1" }, { cookie: mod }),
      env,
    );

    // Hiding a post that leaves its pictures reachable would not be hiding it.
    expect((await app.request(`${ORIGIN}${uploaded.url}`, undefined, env)).status).toBe(404);
  });
});
