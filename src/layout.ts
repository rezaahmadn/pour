import { html } from "hono/html";
import type { User } from "./env";

type PageOptions = {
  title: string;
  user: User | null;
  /** Extra tags for <head>, e.g. the Turnstile script. */
  head?: unknown;
  body: unknown;
};

export function page(opts: PageOptions) {
  const account = opts.user
    ? html`<span>@${opts.user.handle}</span>
        <form method="post" action="/logout" class="inline"><button type="submit">log out</button></form>`
    : html`<a href="/login">log in</a>`;
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${opts.title}</title>
        <link rel="stylesheet" href="/style.css" />
        ${opts.head ?? ""}
      </head>
      <body>
        <header><a href="/">pour</a> · <a href="/write">write</a> · ${account}</header>
        <main>${opts.body}</main>
      </body>
    </html>`;
}
