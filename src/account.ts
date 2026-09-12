export const NUMBER_LENGTH = 16;
export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
export const RESERVED_HANDLES = new Set([
  "admin", "pour", "tag", "verify", "write", "login", "logout", "signup",
  "health", "static", "api", "rss", "feed", "me", "about", "help",
]);

/** Strips everything except digits. Returns null unless exactly 16 digits remain. */
export function normalizeNumber(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  return digits.length === NUMBER_LENGTH ? digits : null;
}

/** "1234567890123456" -> "1234 5678 9012 3456" */
export function formatNumber(digits: string): string {
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** Trims, lowercases, then enforces HANDLE_RE and the reserved list. */
export function normalizeHandle(input: string): string | null {
  const h = input.trim().toLowerCase();
  if (!HANDLE_RE.test(h) || RESERVED_HANDLES.has(h)) return null;
  return h;
}
