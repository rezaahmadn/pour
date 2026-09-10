const encoder = new TextEncoder();

export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** HMAC-SHA256(secret, message) as lowercase hex. Used for account numbers and IP addresses. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return toHex(new Uint8Array(sig));
}

export function randomHex(bytes: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Uniform random decimal digits. Bytes >= 250 are discarded so `b % 10` is unbiased. */
export function randomDigits(length: number): string {
  let out = "";
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    for (const b of bytes) {
      if (b < 250 && out.length < length) out += String(b % 10);
    }
  }
  return out;
}

/** Unix seconds. All timestamps in D1 use this. */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
