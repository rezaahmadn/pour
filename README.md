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

`.dev.vars` holds local secrets and is gitignored. The example ships Cloudflare's always-pass Turnstile test keys, so signup works offline and the widget solves itself.

The dev server listens on port 8788, since 8787 is wrangler's default and tends to collide. Pass `--port` to change it for one run.

### Testing signup and login locally

Local requests carry no `CF-Connecting-IP`, so every one of them looks like the same client. That means the abuse controls all share a single bucket: three signups exhausts the daily cap, and five bad login guesses locks you out of your own machine. Two scripts get you unstuck.

```sh
npm run db:clear:local   # drop throttle state, keep accounts and posts
npm run db:reset:local   # wipe the local database and re-apply migrations
```

Stop the dev server before `db:reset:local`. It deletes the database directory, and a
running server keeps the old file open, which leaves the server and the CLI reading
two different databases until you restart it.

One more thing worth knowing while testing: a post's `created_at` is part of its hash.
Editing timestamps directly to get around the one-a-minute limit will break the chain
and `/verify` will say so. Publish from separate accounts instead.

To drive the flow from a terminal, note that the token below is the dummy value the test keys accept, and that `Origin` is required because CSRF protection rejects form posts without it.

```sh
curl -c jar -X POST http://localhost:8788/signup \
  -H 'Origin: http://localhost:8788' \
  --data-urlencode 'handle=someone' \
  --data-urlencode 'cf-turnstile-response=XXXX.DUMMY.TOKEN.XXXX'
```

The response prints the account number once. Log in with it, separators and all:

```sh
curl -c jar -X POST http://localhost:8788/login \
  -H 'Origin: http://localhost:8788' \
  --data-urlencode 'number=1234 5678 9012 3456'
```

To act as different clients, set the header the edge would normally add:

```sh
curl -X POST http://localhost:8788/login -H 'Origin: http://localhost:8788' \
  -H 'CF-Connecting-IP: 10.0.0.7' --data-urlencode 'number=0000000000000000'
```

The first attempt from any client is unchallenged on purpose. After that a challenge is required, so include `cf-turnstile-response` on every later attempt.

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

   `INVITE_CODE` is only needed if you close signup. Set it **before** flipping
   `SIGNUP_OPEN` to `"false"` in `wrangler.jsonc`: with the gate closed and no code
   configured, nobody can join at all, which is deliberate but will surprise you.

   `TURNSTILE_SECRET` comes from a Turnstile widget. In the Cloudflare dashboard go to Turnstile, add a widget for hostname `pour.<your-subdomain>.workers.dev` in Managed mode, then paste its **site key** into `vars.TURNSTILE_SITE_KEY` in `wrangler.jsonc` (that key is public) and its **secret key** into the secret above. Until you do, `wrangler.jsonc` ships Cloudflare's always-pass test site key, which real secrets reject, so signup fails in production.

3. Create an API token at https://dash.cloudflare.com/profile/api-tokens using the **Edit Cloudflare Workers** template, and add D1 Edit permission. Find your account ID on the Workers overview page.

4. Add both to the repo:

   ```sh
   gh secret set CLOUDFLARE_API_TOKEN
   gh secret set CLOUDFLARE_ACCOUNT_ID
   ```

5. Push to `main`. The site appears at `https://pour.<your-subdomain>.workers.dev`.

Alternative with zero GitHub secrets: connect the repo under Workers & Pages > Create > Import a repository in the Cloudflare dashboard. Cloudflare then builds and deploys on push itself. Keep the workflow for checks either way.

## Images

Pictures need an R2 bucket, and R2 has to be switched on for the account once, by
hand, at Cloudflare dashboard > R2. It is free to enable and the free tier covers
10 GB with no egress charge, but a deploy fails until the bucket exists:

```sh
npx wrangler r2 bucket create pour-images
```

The browser resizes every picture to 2000 px on the long edge and re-encodes it
through a canvas before upload. That is what removes EXIF, including the GPS
coordinates a phone writes into a photo. The server only accepts formats a canvas
produces and checks the magic bytes, so a file that skipped that step is refused
rather than stored with its location intact.

## License

MIT
