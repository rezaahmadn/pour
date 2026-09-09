import { Hono } from "hono";
import { html } from "hono/html";

type Bindings = { DB: D1Database };

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM posts WHERE hidden = 0",
  ).all<{ n: number }>();
  const n = results[0]?.n ?? 0;
  return c.html(html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>pour</title>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <main>
          <h1>pour</h1>
          <p>A quiet place to write anything. ${n} posts so far.</p>
        </main>
      </body>
    </html>`);
});

app.get("/health", (c) => c.text("ok"));

export default app;
