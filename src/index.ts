import { Hono } from "hono";
import { html } from "hono/html";
import { csrf } from "hono/csrf";
import type { AppEnv } from "./env";
import { requireAuth, sessionMiddleware } from "./auth";
import { page } from "./layout";
import { authRoutes } from "./routes/auth";

const app = new Hono<AppEnv>();

// Registered before csrf() on purpose. A csrf rejection throws without calling
// next(), so anything registered after it never runs and its response would go out
// bare. Sitting outside means this wraps the rejection too.
//
// Every page the Worker renders is either per-account or shows the viewer's handle,
// and the signup page prints the account number itself. None of it may be stored by
// a browser or a shared cache. Static assets bypass the Worker and keep their own headers.
app.use(async (c, next) => {
  await next();
  c.header("Cache-Control", "private, no-store");
  c.header("Referrer-Policy", "same-origin");
  c.header("X-Content-Type-Options", "nosniff");
  // Nothing here should ever be framed. Stops a third-party page from overlaying
  // a decoy on the challenge widget or the logout button.
  c.header("X-Frame-Options", "DENY");
});

// Rejects form POSTs whose Origin (or Sec-Fetch-Site) is not this site. Browsers always send one.
app.use(csrf());
app.use(sessionMiddleware);

app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM posts WHERE hidden = 0",
  ).all<{ n: number }>();
  const n = results[0]?.n ?? 0;
  return c.html(
    page({
      title: "pour",
      user: c.get("user"),
      body: html`<h1>pour</h1>
        <p>A quiet place to write anything. ${n} posts so far.</p>`,
    }),
  );
});

app.get("/health", (c) => c.text("ok"));

// Stub until Phase 3 adds the editor. Exists so the login flow has a destination.
app.get("/write", requireAuth, (c) => {
  const user = c.get("user")!;
  return c.html(
    page({
      title: "write",
      user,
      body: html`<h1>write</h1>
        <p>Editor arrives in phase 3. You are logged in as @${user.handle}.</p>`,
    }),
  );
});

app.route("/", authRoutes);

export default app;
