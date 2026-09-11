import { Hono } from "hono";
import { html } from "hono/html";
import { csrf } from "hono/csrf";
import type { AppEnv } from "./env";
import { sessionMiddleware } from "./auth";
import { page } from "./layout";
import { authRoutes } from "./routes/auth";
import { adminRoutes } from "./routes/admin";
import { feedRoutes } from "./routes/feeds";
import { imageRoutes } from "./routes/images";
import { timelineRoutes } from "./routes/timeline";
import { postRoutes } from "./routes/post";
import { verifyRoutes } from "./routes/verify";
import { writeRoutes } from "./routes/write";

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
  // A route that set its own caching meant it; feeds carry no per-viewer content.
  if (!c.res.headers.get("Cache-Control")) c.header("Cache-Control", "private, no-store");
  c.header("Referrer-Policy", "same-origin");
  c.header("X-Content-Type-Options", "nosniff");
  // Nothing here should ever be framed. Stops a third-party page from overlaying
  // a decoy on the challenge widget or the logout button.
  c.header("X-Frame-Options", "DENY");
});

// Rejects form POSTs whose Origin (or Sec-Fetch-Site) is not this site. Browsers always send one.
app.use(csrf());
app.use(sessionMiddleware);

app.get("/health", (c) => c.text("ok"));

app.route("/", timelineRoutes);
app.route("/", feedRoutes);
app.route("/", authRoutes);
app.route("/", writeRoutes);
app.route("/", postRoutes);
app.route("/", imageRoutes);
app.route("/", verifyRoutes);
app.route("/", adminRoutes);

export default app;
