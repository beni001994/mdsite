# mdsite

A small static site generator written in TypeScript. It turns a folder of Markdown files with front matter into a static HTML site, using a hand-written Markdown parser and **zero runtime dependencies** (only Node's standard library).

It is a portfolio/learning project: small enough to read in an afternoon, with an extensive test suite. It is not trying to replace Hugo, Eleventy or Jekyll (see [Limitations](#limitations)).

## Features

- `mdsite build`: Markdown to HTML with a layout, an auto-generated index, tag pages, navigation and an RSS 2.0 feed
- `mdsite new <title>`: scaffolds a draft post with front matter
- `mdsite serve`: builds, serves the output on `127.0.0.1` and rebuilds when files change
- Hand-written Markdown parser: headings, emphasis, links, images, fenced code, lists (nested), blockquotes, tables, hard breaks, backslash escapes, autolinks
- Everything is HTML-escaped; raw HTML in Markdown is never passed through; link and image URLs go through a scheme allow-list
- A small YAML-like front matter parser (`title`, `date`, `tags`, `draft`, `description`, `order`) that reports errors with file and line
- Relative links everywhere, so the output works from any sub-path or straight from disk
- Draft support, static file copying, a replaceable layout template

## Quick start

Requires Node.js 22 or newer.

```sh
npm install
npm run build

# build the bundled example site into example/dist
node dist/bin.js build -C example

# preview it with rebuild-on-change
node dist/bin.js serve -C example
```

To use it on your own folder (after `npm run build`, either `npm link` or call `node /path/to/mdsite/dist/bin.js`):

```sh
mdsite new "My first post"      # creates content/posts/my-first-post.md (draft: true)
mdsite build --drafts           # include drafts
mdsite serve                    # http://127.0.0.1:4000/
```

### Commands and options

```
mdsite build [options]          Build the site into the output directory
mdsite new <title> [options]    Create content/posts/<slug>.md (as a draft)
mdsite serve [options]          Build, serve over HTTP and rebuild on change

-C, --root <dir>    Site directory (default: current directory)
-o, --out <dir>     Output directory (default: "dist" or mdsite.json "outDir")
    --drafts        Include posts marked "draft: true"
-p, --port <n>      Port for serve (default 4000; 0 picks a free port)
    --host <host>   Host for serve (default 127.0.0.1)
-h, --help / -v, --version
```

Exit codes: `0` success, `1` build/content error (message on stderr), `2` usage error.

## Site layout

```
my-site/
  mdsite.json      optional configuration
  layout.html      optional layout template (default is built in)
  content/         Markdown files (any depth)
    about.md       -> about.html          (no date: a page, shown in the nav)
    posts/hello.md -> posts/hello.html    (has a date: a post)
  static/          copied verbatim into the output
  dist/            generated output (safe to delete)
```

### `mdsite.json`

| key | default | meaning |
| --- | --- | --- |
| `title` | `"My Site"` | site title |
| `description` | `""` | shown on the index, used as default meta description and in the feed |
| `baseUrl` | none | absolute URL of the site root; **required for the RSS feed** |
| `language` | `"en"` | `lang` attribute and feed language |
| `author` | none | accepted, currently unused |
| `feedLimit` | `20` | max items in the feed |
| `contentDir`, `staticDir`, `outDir` | `content`, `static`, `dist` | directories relative to the site root |

Unknown keys are an error, so typos are caught.

### Front matter

```markdown
---
title: "Hello, world"       # defaults to the file name if missing
date: 2025-03-02            # YYYY-MM-DD, optionally with time/offset; makes this a post
tags: [meta, markdown]      # or a block list, or a comma-separated string
draft: true                 # unquoted true/false; drafts are skipped unless --drafts
description: Shown in <meta name="description">
order: 2                    # position of an undated page in the navigation
---
```

Supported syntax: plain / `'single'` / `"double"` quoted strings (with `\n \t \" \\` escapes in double quotes), booleans, inline lists, block lists, `#` comments. Anything else (nested maps, multi-line strings, anchors) is reported as an error rather than silently ignored.

### Layout template

Put a `layout.html` next to `mdsite.json` to replace the built-in one. `{{name}}` inserts an HTML-escaped value, `{{{name}}}` inserts a raw HTML fragment. Available variables: `lang`, `siteTitle`, `pageTitle`, `title`, `description`, `base`, `head`, `nav`, `content`. An unknown variable is a build error. `{{base}}` is the relative path back to the site root (`./`, `../`, ...); use it for assets, e.g. `<link rel="stylesheet" href="{{base}}assets/style.css">`. To replace the default stylesheet, add `static/assets/style.css`.

### Links between pages

Because the output uses relative links and no server-side routing, Markdown links are plain relative links **between output files**, written from the page's own location: from `posts/welcome.md` the about page is `../about.html`. There is no link rewriting.

## Markdown support

| supported | notes |
| --- | --- |
| ATX headings `#` to `######` | get slug `id`s, deduplicated (`foo`, `foo-2`) |
| paragraphs, soft breaks, hard breaks | two trailing spaces or a trailing `\` |
| `*em*`, `_em_`, `**strong**`, `***both***` | CommonMark flanking rules incl. the "rule of 3"; intraword `_` is not emphasis |
| `` `code` `` spans | any backtick run length |
| fenced code blocks | backticks or tildes, `lang` becomes `class="language-x"` when it is a safe token |
| `[text](url "title")`, `![alt](src "title")` | angle-bracket destinations, balanced parentheses, nested images in links |
| `<https://autolinks>` and `<email@x.y>` | |
| bullet and ordered lists | nesting, loose/tight, start numbers |
| blockquotes | nested, lazy continuation |
| tables | header + delimiter row, `:--` / `:-:` / `--:` alignment, escaped `\|` |
| thematic breaks, backslash escapes | |

## Architecture

```
src/
  bin.ts          process entry: signals, stdout/stderr wiring
  cli.ts          argument parsing (node:util parseArgs) and command dispatch; exported main() is testable
  site.ts         loadSite (I/O + parsing) -> renderSite (pure) -> buildSite (writes files)
  markdown.ts     block parser + inline parser (delimiter-stack emphasis)
  frontmatter.ts  YAML-subset parser
  meta.ts         validation of front matter into typed metadata, date parsing
  template.ts     {{ }} template engine, default layout and CSS
  rss.ts          RSS 2.0 feed generation
  config.ts       mdsite.json loading and validation
  serve.ts        static HTTP server, path-traversal-safe resolver, fs.watch rebuild
  new.ts          `mdsite new`
  escape.ts       HTML/XML escaping and the URL allow-list
  slug.ts         slugify / uniqueSlug
  errors.ts       MdsiteError and friends (user-facing messages)
```

Build pipeline:

1. `loadConfig` reads and validates `mdsite.json`.
2. `loadSite` walks `content/` (sorted, so output is deterministic), splits front matter from body, validates metadata, renders Markdown, and detects collisions (two sources with the same output path, a source colliding with a generated page, tags with the same slug).
3. `renderSite` is a pure function from the loaded site to a `Map<path, content>`: entry pages, index, tag pages, feed, stylesheet. This is why most of it is unit-testable without touching the file system.
4. `buildSite` validates static files, then prepares the output directory and writes. Everything that can fail on content fails **before** the output directory is touched, so a failed rebuild in `serve` leaves the previous output in place.

Markdown parsing is two-level. The block parser works on lines: it recognizes fences, headings, rules, blockquotes, lists and tables, and recurses on the contents of quotes and list items (with a depth limit). Paragraph text goes to the inline parser, which tokenizes into text/HTML nodes and emphasis delimiter runs, then pairs delimiters with a CommonMark-style delimiter-stack pass. Link text is parsed recursively. A work budget proportional to input size bounds the inline parser so that pathological input (thousands of unmatched `[` or `*`) cannot cause quadratic slowdowns; the test suite includes such inputs.

### Security model

- All text is escaped with `escapeHtml`. The parser has no code path that copies source HTML into output.
- Attributes are always double-quoted and escaped. Code fence languages are restricted to `[\w+#.-]+`. Heading ids come from `slugify`.
- Link, image and autolink URLs must be relative or use `http`, `https`, `mailto` or `tel`. `javascript:`, `data:`, `vbscript:`, `file:` and variants hiding the scheme behind whitespace or control characters are rejected (links lose their anchor, images are replaced by their alt text). Entities in URLs are not decoded, so `&#106;avascript:` stays inert.
- The dev server binds to loopback by default, only answers `GET`/`HEAD`, resolves paths with decoding and containment checks (`..`, encoded dots, backslashes and NUL bytes are rejected), and never serves dot files.
- `mdsite build` only deletes inside an output directory that carries its own `.mdsite-output` marker, and refuses a non-empty directory without one.

This protects against injection **through content**. It does not sandbox the layout template or `mdsite.json`, which you control and which are trusted.

## Development

```sh
npm install
npm run typecheck
npm test            # vitest
npm run build       # tsc -> dist/
```

Tests cover the Markdown parser (block and inline edge cases, escaping, robustness against pathological input), XSS/URL injection, front matter, metadata and dates, slugs, templates, configuration, site building (including collisions and output directory safety), RSS, the CLI, the dev server (including path traversal and rebuild on change) and the example site.

## Limitations

This is deliberately small. Known gaps and deviations:

- **Markdown is not fully CommonMark/GFM compliant.** Not supported: raw HTML pass-through (it is escaped by design), reference-style links and definitions, setext headings (`Title` over `===`/`---`), indented code blocks (4-space indented text is a paragraph), task list checkboxes, strikethrough, footnotes, bare URL autolinking, HTML entities (they are shown literally, `&copy;` renders as the text `&copy;`), tabs after list markers.
- Loose/tight list detection is a heuristic; unusual layouts (for example fenced code with blank lines inside an item that is otherwise tight) may produce `<p>` wrappers CommonMark would not.
- Tables: pipes inside code spans still split cells unless escaped, and a table cannot interrupt a paragraph.
- Front matter is a YAML subset. Dates are validated, not timezone-converted for display: the date shown is the `YYYY-MM-DD` you wrote.
- Slugs are ASCII only. Accents are stripped, but non-Latin scripts are dropped, so a file or tag named only in, say, Japanese cannot be built (the build fails with a clear message rather than producing an empty URL). Tags that differ only in punctuation (`C++` and `C#`) collide and are rejected.
- The RSS feed embeds the rendered HTML with relative links/images exactly as written; they are **not** rewritten to absolute URLs, so relative links inside feed readers may not resolve. `author` is accepted in the config but unused.
- No pagination, no syntax highlighting (code blocks get a `language-x` class for a client-side highlighter), no image processing, no sitemap, no incremental builds (every build rewrites the whole output), no theming system beyond replacing `layout.html` and the stylesheet.
- `serve` rebuilds the whole site on change, relies on `fs.watch` recursive mode (which behaves differently across platforms), does not live-reload the browser, and is a convenience for local preview, not a production server.
- Symbolic links inside `content/` and `static/` are skipped with a warning.
- Only unit/integration tests run in CI; there are no browser tests, and the generated HTML has not been checked with an HTML validator.

## License

MIT
