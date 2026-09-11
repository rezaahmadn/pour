import { html, raw } from "hono/html";
import { STYLES } from "./styles";
import type { User } from "./env";

type PageOptions = {
  title: string;
  /** One line for search results and link previews. Falls back to the site's own. */
  description?: string;
  user: User | null;
  /** Extra tags for <head>, e.g. the Turnstile script. */
  head?: unknown;
  body: unknown;
};

export function page(opts: PageOptions) {
  const account = opts.user
    ? html`<span class="handle">@${opts.user.handle}</span>
        <form method="post" action="/logout">
          <button type="submit" class="linkish">log out</button>
        </form>`
    : html`<a href="/login">log in</a>`;
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${opts.title}</title>
        <meta
          name="description"
          content="${opts.description ?? "A quiet place to write anything. Public, anonymous, append-only."}"
        />
        <style>${raw(STYLES)}</style>
        ${opts.head ?? ""}
      </head>
      <body>
        <header>
          <nav>
            <a class="brand" href="/">pour</a>
            <a href="/write">write</a>
            ${account}
          </nav>
        </header>
        <main>${opts.body}</main>
      </body>
    </html>`;
}
