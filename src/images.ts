import { randomHex, sha256HexOfBytes } from "./crypto";

/**
 * Only formats a canvas produces. The browser re-encodes every picture before
 * upload, which is what strips EXIF, so anything arriving as a HEIC or a TIFF
 * skipped that step and is refused rather than stored with its GPS intact.
 */
export const ALLOWED_TYPES = new Set(["image/webp", "image/jpeg", "image/png"]);

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_POST = 10;

const EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/** Random, so a key reveals nothing about who uploaded it or when. */
export function imageKey(contentType: string): string {
  return `${randomHex(16)}.${EXTENSIONS[contentType] ?? "bin"}`;
}

export type ImageCheck = { ok: true; bytes: Uint8Array; sha256: string } | { ok: false; error: string };

export async function checkImage(file: File): Promise<ImageCheck> {
  if (!ALLOWED_TYPES.has(file.type)) {
    return { ok: false, error: "That image format is not accepted. Pick a photo and try again." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: "That image is too large." };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) return { ok: false, error: "That image is empty." };
  if (bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, error: "That image is too large." };
  if (!looksLikeImage(bytes, file.type)) {
    return { ok: false, error: "That file is not the image it claims to be." };
  }
  return { ok: true, bytes, sha256: await sha256HexOfBytes(bytes) };
}

/**
 * Checks the magic bytes rather than trusting the declared type. A caller can
 * claim any content type it likes; the file itself cannot.
 */
export function looksLikeImage(bytes: Uint8Array, contentType: string): boolean {
  const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (contentType === "image/jpeg") return startsWith(0xff, 0xd8, 0xff);
  if (contentType === "image/png") return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (contentType === "image/webp") {
    return startsWith(0x52, 0x49, 0x46, 0x46) && [8, 9, 10, 11].every(
      (i, n) => bytes[i] === [0x57, 0x45, 0x42, 0x50][n],
    );
  }
  return false;
}
