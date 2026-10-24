import { escapeHtml } from './escape.js';
import { TemplateError } from './errors.js';

/**
 * Minimal template engine.
 *
 *   {{name}}    HTML-escaped value
 *   {{{name}}}  raw value (for HTML fragments produced by mdsite)
 *
 * Substitution is a single pass, so values are never re-scanned for
 * placeholders. Unknown variable names are an error, which catches typos.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(
    /\{\{\{\s*([A-Za-z_]\w*)\s*\}\}\}|\{\{\s*([A-Za-z_]\w*)\s*\}\}/g,
    (_m, rawName: string | undefined, escName: string | undefined) => {
      const name = (rawName ?? escName) as string;
      if (!Object.hasOwn(vars, name)) {
        throw new TemplateError(
          `layout uses unknown variable "${name}" (available: ${Object.keys(vars).join(', ')})`,
        );
      }
      return rawName !== undefined ? vars[name] : escapeHtml(vars[name]);
    },
  );
}

export const DEFAULT_LAYOUT = `<!doctype html>
<html lang="{{lang}}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{pageTitle}}</title>
<meta name="description" content="{{description}}">
<link rel="stylesheet" href="{{base}}assets/style.css">
{{{head}}}
</head>
<body>
<header class="site-header">
<a class="site-title" href="{{base}}index.html">{{siteTitle}}</a>
<nav aria-label="Main">
{{{nav}}}
</nav>
</header>
<main>
{{{content}}}
</main>
<footer class="site-footer">
<p>{{siteTitle}} &middot; built with mdsite</p>
</footer>
</body>
</html>
`;

export const DEFAULT_CSS = `:root {
  --bg: #fdfdfc;
  --fg: #1d1f21;
  --muted: #666b73;
  --accent: #0b5cad;
  --border: #dcdfe3;
  --code-bg: #f2f3f5;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #15171a;
    --fg: #e6e7e9;
    --muted: #9aa0a8;
    --accent: #6cb0f5;
    --border: #2d3138;
    --code-bg: #1f2227;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0 auto;
  max-width: 44rem;
  padding: 1rem;
  background: var(--bg);
  color: var(--fg);
  font: 1rem/1.65 system-ui, -apple-system, "Segoe UI", sans-serif;
}
a { color: var(--accent); }
.site-header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.5rem;
  align-items: baseline;
  justify-content: space-between;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--border);
}
.site-title { font-weight: 700; font-size: 1.2rem; color: var(--fg); text-decoration: none; }
nav a { margin-right: 1rem; }
nav a[aria-current="page"] { color: var(--fg); font-weight: 600; text-decoration: none; }
main { padding: 1rem 0; }
.meta, .post-list time, .site-footer { color: var(--muted); font-size: 0.9rem; }
.post-list { list-style: none; padding: 0; }
.post-list li { margin: 0.75rem 0; }
.tags a { margin-right: 0.5rem; }
pre, code { background: var(--code-bg); border-radius: 4px; }
code { padding: 0.1em 0.3em; font-size: 0.9em; }
pre { padding: 0.8rem 1rem; overflow-x: auto; }
pre code { padding: 0; background: none; }
blockquote { margin-left: 0; padding-left: 1rem; border-left: 3px solid var(--border); color: var(--muted); }
table { border-collapse: collapse; margin: 1rem 0; }
th, td { border: 1px solid var(--border); padding: 0.3rem 0.7rem; }
img { max-width: 100%; height: auto; }
`;
