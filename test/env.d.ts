// Test-only bindings injected by vitest.config.ts. Merged into the generated Cloudflare.Env.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    PEPPER: string;
    TURNSTILE_SECRET: string;
    TURNSTILE_SITE_KEY: string;
    ADMIN_HANDLE: string;
  }
}
