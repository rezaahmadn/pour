# pour

A quiet place to write anything. Public, anonymous, append-only.

- Sign up with a generated account number. No email, no password.
- Write markdown, tag it, publish. Posts cannot be edited or deleted.
- One shared timeline. Every post is part of a hash chain anyone can verify.
- Fast on phones. Server-rendered, almost no JavaScript, drafts autosave locally.

Live at https://pour.rezaahmadn.workers.dev. Runs on Cloudflare Workers, D1, and R2 free tiers.

Design and scope: [`.claude/PRPs/prds/pour.prd.md`](.claude/PRPs/prds/pour.prd.md)

## Develop

```sh
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

`.dev.vars` holds local secrets and is gitignored. The example ships Cloudflare's always-pass Turnstile test keys, so signup works offline.

`npm run check` typechecks, `npm test` runs vitest.

## Deploy (one-time setup, about 5 minutes)

Every push to `main` runs checks, applies D1 migrations, and deploys. Until the two secrets below exist, the deploy job skips itself.

1. Log in and create the database:

   ```sh
   npx wrangler login
   npx wrangler d1 create pour
   ```

   Paste the returned `database_id` into `wrangler.jsonc`.

2. Set Worker secrets (never commit these):

   ```sh
   openssl rand -hex 32 | npx wrangler secret put PEPPER
   npx wrangler secret put ADMIN_HANDLE
   npx wrangler secret put TURNSTILE_SECRET
   ```

   Set `PEPPER` once and never rotate it: it keys the HMAC of every account number, so changing it locks every existing account out permanently.

   `TURNSTILE_SECRET` comes from a Turnstile widget. In the Cloudflare dashboard go to Turnstile, add a widget for hostname `pour.<your-subdomain>.workers.dev` in Managed mode, then paste its **site key** into `vars.TURNSTILE_SITE_KEY` in `wrangler.jsonc` (that key is public) and its **secret key** into the secret above. Until you do, `wrangler.jsonc` ships Cloudflare's always-pass test site key, which real secrets reject, so signup fails in production.

3. Create an API token at https://dash.cloudflare.com/profile/api-tokens using the **Edit Cloudflare Workers** template, and add D1 Edit permission. Find your account ID on the Workers overview page.

4. Add both to the repo:

   ```sh
   gh secret set CLOUDFLARE_API_TOKEN
   gh secret set CLOUDFLARE_ACCOUNT_ID
   ```

5. Push to `main`. The site appears at `https://pour.<your-subdomain>.workers.dev`.

Alternative with zero GitHub secrets: connect the repo under Workers & Pages > Create > Import a repository in the Cloudflare dashboard. Cloudflare then builds and deploys on push itself. Keep the workflow for checks either way.

## License

MIT
