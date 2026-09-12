/**
 * The stylesheet, inlined into every page rather than fetched.
 *
 * It is small, and a separate request for it was the one thing blocking first
 * paint: a Slow 4G trace put 538 ms of a 1.23 s LCP on that round trip. This
 * project exists to be fast on a phone, so the round trip loses. Kept here as
 * one source of truth rather than duplicated as a static file.
 */
export const STYLES = `/* pour. Text first, one accent, system fonts, mobile first.
   Everything is driven off one spacing scale so gaps stay consistent. */

:root {
  color-scheme: light dark;

  /* Paper and ink, not a warm wash. The accent earns its place by marking what
     you can act on, and nothing else; red is kept back for things going wrong,
     so the two never have to argue about what a colour means. */
  --bg: #ffffff;
  --fg: #16161a;
  --muted: #5f5f6b;
  --line: #e3e3e8;
  --accent: #1a3fa8;
  --wash: #f3f4f9;
  --danger: #a11212;

  --s1: 0.35rem;
  --s2: 0.7rem;
  --s3: 1.15rem;
  --s4: 1.9rem;
  --s5: 3rem;

  --radius: 5px;

  --sans: system-ui, -apple-system, "Segoe UI", sans-serif;
  --serif: ui-serif, Georgia, "Iowan Old Style", "Times New Roman", serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0e0e11;
    --fg: #e8e8ec;
    --muted: #9494a0;
    --line: #26262d;
    --accent: #9db4ff;
    --wash: #17171d;
    --danger: #ff9494;
  }
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  max-width: 36rem;
  margin: 0 auto;
  padding: var(--s4) var(--s3) var(--s5);
  background: var(--bg);
  color: var(--fg);
  font: 1rem/1.6 var(--sans);
  -webkit-text-size-adjust: 100%;
}

a {
  color: var(--accent);
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}

a:hover {
  text-decoration-thickness: 2px;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 2px;
}

/* Header. A flex row so the logout form sits on the same line as the links
   instead of dropping below them, which is what a block-level form does. */

header {
  padding-bottom: var(--s3);
  margin-bottom: var(--s4);
  border-bottom: 1px solid var(--line);
  font-size: 0.95rem;
}

header nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s1) var(--s3);
}

header nav .brand {
  font-weight: 600;
  color: var(--fg);
  text-decoration: none;
}

header nav .brand:hover {
  color: var(--accent);
}

header nav .handle {
  color: var(--muted);
  margin-left: auto;
}

/* Lifts the button out of the form box so it joins the flex row directly. */
header nav form {
  display: contents;
}

/* Typography */

h1 {
  margin: 0 0 var(--s4);
  font-size: 2rem;
  font-weight: 640;
  line-height: 1.15;
  letter-spacing: -0.022em;
}

p {
  margin: 0 0 var(--s3);
}

main > :last-child {
  margin-bottom: 0;
}

/* Forms */

form {
  margin: var(--s4) 0;
}

label {
  display: block;
  margin-bottom: var(--s3);
  color: var(--muted);
  font-size: 0.9rem;
}

input {
  display: block;
  width: 100%;
  margin-top: var(--s1);
  padding: 0.62rem 0.7rem;
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font: inherit;
}

input:focus {
  border-color: var(--accent);
}

button {
  padding: 0.62rem 1.15rem;
  background: var(--accent);
  color: var(--bg);
  border: 0;
  border-radius: var(--radius);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}

button:hover {
  filter: brightness(1.08);
}

/* A button that has to read as a link, in the header and beside Download. */
.linkish {
  padding: 0;
  background: none;
  color: var(--accent);
  font-weight: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.linkish:hover {
  filter: none;
  text-decoration-thickness: 2px;
}

/* The challenge widget is an iframe with no margin of its own. */
.cf-turnstile {
  margin: var(--s3) 0;
}

.error {
  margin: 0 0 var(--s3);
  padding: var(--s2) var(--s3);
  border-left: 3px solid var(--danger);
  border-radius: 0 var(--radius) var(--radius) 0;
  background: var(--wash);
}

/* The account number. The only copy of a credential that cannot be recovered,
   so it gets the weight on the page rather than reading as a caption. */

.number {
  margin: 0 0 var(--s4);
  padding: var(--s3) var(--s2);
  background: var(--wash);
  border-radius: var(--radius);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: clamp(1.25rem, 6.2vw, 1.85rem);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-align: center;
  word-spacing: 0.25em;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s3);
}

.note {
  color: var(--muted);
  font-size: 0.95rem;
}

/* Editor */

textarea {
  display: block;
  width: 100%;
  margin-top: var(--s1);
  padding: var(--s2);
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font: inherit;
  line-height: 1.6;
  resize: vertical;
}

textarea:focus {
  border-color: var(--accent);
}

/* Timeline */

.timeline {
  margin: 0;
  padding: 0;
  list-style: none;
}

.timeline > li {
  padding-bottom: var(--s4);
  margin-bottom: var(--s4);
  border-bottom: 1px solid var(--line);
}

.timeline > li:last-child {
  padding-bottom: 0;
  margin-bottom: 0;
  border-bottom: 0;
}

.excerpt {
  margin: 0;
}

.excerpt {
  font-family: var(--serif);
  font-size: 1.08rem;
  line-height: 1.6;
}

.excerpt a {
  color: var(--fg);
  text-decoration: none;
}

.excerpt a:hover {
  color: var(--accent);
}

.meta {
  margin: 0 0 var(--s1);
  color: var(--muted);
  font-size: 0.88rem;
}

.meta a {
  color: var(--muted);
}

.tags {
  margin-left: var(--s1);
}

.tag {
  margin-right: var(--s1);
  color: var(--accent);
}

/* A rendered post */

.post {
  overflow-wrap: break-word;
  font-family: var(--serif);
  font-size: 1.15rem;
  line-height: 1.7;
}

.post > :first-child {
  margin-top: 0;
}

.post > :last-child {
  margin-bottom: 0;
}

.post h1,
.post h2,
.post h3 {
  margin: var(--s4) 0 var(--s2);
  font-size: 1.25rem;
  line-height: 1.3;
}

.post pre {
  padding: var(--s2);
  overflow-x: auto;
  background: var(--wash);
  border-radius: var(--radius);
  font-size: 0.9rem;
}

.post code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.92em;
}

.post blockquote {
  margin: var(--s3) 0;
  padding-left: var(--s3);
  border-left: 3px solid var(--line);
  color: var(--muted);
}

.post img {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius);
}

.post ul,
.post ol {
  padding-left: var(--s3);
}

.post hr {
  border: 0;
  border-top: 1px solid var(--line);
  margin: var(--s4) 0;
}

/* Draft restore offer */

.restore {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s2) var(--s3);
  margin: var(--s3) 0;
  padding: var(--s3);
  background: var(--wash);
  border-radius: var(--radius);
  font-size: 0.95rem;
}

/* Message on its own line so the two actions group together underneath, rather
   than the second one wrapping alone. */
.restore > span {
  flex: 1 0 100%;
}

.restore button {
  padding: 0.35rem 0.8rem;
  font-size: 0.9rem;
}

.restore .linkish {
  padding: 0;
}

#draft-status {
  font-variant-numeric: tabular-nums;
}

/* Admin and verification */

h2 {
  margin: var(--s5) 0 var(--s3);
  font-size: 1.15rem;
}

.flag {
  margin-left: var(--s1);
  padding: 0.1rem 0.4rem;
  background: var(--wash);
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 0.8rem;
  color: var(--muted);
}

.hidden-entry .excerpt {
  color: var(--muted);
  font-size: 0.95rem;
}

.inline-form {
  display: inline;
  margin: 0;
}

.verdict {
  font-size: 1.15rem;
  font-weight: 600;
}

.verdict.ok {
  color: var(--accent);
}

.verdict.bad {
  color: var(--danger);
}

code {
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.88em;
}

/* Paging and tag links */

.pager {
  margin-top: var(--s4);
}

a.tag {
  text-decoration: none;
}

a.tag:hover {
  text-decoration: underline;
}

/* .meta a is more specific than a.tag, so name both to keep tags on the accent. */
.meta a.tag {
  color: var(--accent);
}

/* Anything after a list needs its own air, since the last row drops its margin. */
.timeline + .note,
.timeline + .pager,
.pager + .note {
  margin-top: var(--s4);
}

/* Picture picker */

.picker {
  margin-bottom: var(--s2);
}

.picker input[type="file"] {
  border: 0;
  padding-left: 0;
}
`;
