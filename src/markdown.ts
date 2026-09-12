import { micromark } from "micromark";

/**
 * Renders a post body to HTML.
 *
 * micromark is safe at its defaults: raw HTML in the source is escaped to text
 * rather than emitted as elements, and link protocols are limited to http, https,
 * irc, ircs, mailto and xmpp, with images limited to http and https. That is why
 * there is no sanitizer here.
 *
 * Never pass allowDangerousHtml or allowDangerousProtocol. Both turn this into an
 * cross-site scripting hole, since post bodies come from anonymous strangers.
 */
export function renderMarkdown(body: string): string {
  return micromark(body);
}
