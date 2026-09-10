import { env } from "cloudflare:workers";
import { vi } from "vitest";
import app from "../src/index";
import { TURNSTILE_VERIFY_URL } from "../src/turnstile";

export const ORIGIN = "http://localhost";

let ipCounter = 1;
/** A fresh private IP per call so the per-IP signup cap never trips by accident. */
export function freshIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

export function formPost(
  fields: Record<string, string>,
  opts: { cookie?: string; ip?: string; origin?: string | null } = {},
): RequestInit {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    "cf-connecting-ip": opts.ip ?? freshIp(),
  };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.cookie) headers.cookie = opts.cookie;
  return { method: "POST", headers, body: new URLSearchParams(fields).toString() };
}

export function sessionCookie(res: Response): string {
  const m = /session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "");
  if (!m) throw new Error("no session cookie in response");
  return `session=${m[1]}`;
}

// `@cloudflare/vitest-plugin` 1.x dropped the `fetchMock` export that older
// `vitest-pool-workers` had. The Worker under test runs in this isolate, so a
// global stub intercepts its outbound calls. Anything unmocked throws, which is
// the equivalent of the old `disableNetConnect()`.
const turnstileQueue: (boolean | "throw")[] = [];

export function installFetchMock(): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === TURNSTILE_VERIFY_URL) {
      const next = turnstileQueue.shift();
      if (next === undefined) throw new Error("Turnstile called with no mock queued");
      if (next === "throw") throw new TypeError("Network connection lost.");
      return Response.json({ success: next });
    }
    throw new Error(`unmocked outbound fetch: ${url}`);
  });
}

export function uninstallFetchMock(): void {
  vi.unstubAllGlobals();
}

/** Queues one Turnstile siteverify reply. Consumed by the next verifyTurnstile call. */
export function mockTurnstile(success: boolean): void {
  turnstileQueue.push(success);
}

/** Makes the next Turnstile call fail the way an unreachable siteverify would. */
export function mockTurnstileNetworkFailure(): void {
  turnstileQueue.push("throw");
}

/** Fails when a queued Turnstile reply was never consumed, catching tests that returned early. */
export function assertNoPendingMocks(): void {
  if (turnstileQueue.length > 0) {
    const n = turnstileQueue.length;
    turnstileQueue.length = 0;
    throw new Error(`${n} queued Turnstile mock(s) were never used`);
  }
}

export async function signup(
  handle: string,
  ip = freshIp(),
): Promise<{ status: number; number: string; cookie: string; body: string }> {
  mockTurnstile(true);
  const res = await app.request(
    `${ORIGIN}/signup`,
    formPost({ handle, "cf-turnstile-response": "tok" }, { ip }),
    env,
  );
  const body = await res.text();
  const m = /data-digits="(\d{16})"/.exec(body);
  if (!m) throw new Error(`signup failed with ${res.status}: ${body.slice(0, 200)}`);
  return { status: res.status, number: m[1], cookie: sessionCookie(res), body };
}

/** POSTs to /login. Supply a token when the client already has a failure on record. */
export function loginPost(
  number: string,
  opts: { ip?: string; token?: string } = {},
): RequestInit {
  const fields: Record<string, string> = { number };
  if (opts.token !== undefined) fields["cf-turnstile-response"] = opts.token;
  return formPost(fields, { ip: opts.ip });
}
