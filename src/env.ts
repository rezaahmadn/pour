export type Bindings = {
  DB: D1Database;
  PEPPER: string;
  TURNSTILE_SECRET: string;
  TURNSTILE_SITE_KEY: string;
  ADMIN_HANDLE?: string;
  /** "false" closes open signup; anyone joining then needs INVITE_CODE. */
  SIGNUP_OPEN?: string;
  INVITE_CODE?: string;
  // Required, matching the `ratelimits` block in wrangler.jsonc. Declaring them
  // optional would let a renamed or deleted binding compile clean and silently
  // switch both throttles off in production.
  LOGIN_LIMITER: RateLimit;
  SIGNUP_LIMITER: RateLimit;
};

export type User = { id: string; handle: string; frozen: number };

export type Variables = { user: User | null };

export type AppEnv = { Bindings: Bindings; Variables: Variables };
