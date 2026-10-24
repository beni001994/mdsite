import { describe, expect, it } from 'vitest';
import { TemplateError } from '../src/errors.js';
import { DEFAULT_LAYOUT, renderTemplate } from '../src/template.js';

describe('renderTemplate', () => {
  it('substitutes escaped variables with double braces', () => {
    expect(renderTemplate('<p>{{x}}</p>', { x: '<b>&"\'' })).toBe('<p>&lt;b&gt;&amp;&quot;&#39;</p>');
  });

  it('substitutes raw variables with triple braces', () => {
    expect(renderTemplate('<p>{{{x}}}</p>', { x: '<b>ok</b>' })).toBe('<p><b>ok</b></p>');
  });

  it('allows whitespace inside braces', () => {
    expect(renderTemplate('{{ a }}|{{{ b }}}', { a: '1', b: '2' })).toBe('1|2');
  });

  it('substitutes the same variable more than once', () => {
    expect(renderTemplate('{{a}}{{a}}', { a: 'x' })).toBe('xx');
  });

  it('does not re-scan substituted values for placeholders', () => {
    expect(renderTemplate('{{a}} {{{b}}}', { a: '{{b}}', b: '{{a}}' })).toBe('{{b}} {{a}}');
  });

  it('does not interpret $ patterns in values', () => {
    expect(renderTemplate('{{{a}}}', { a: "$& $1 $' $$" })).toBe("$& $1 $' $$");
  });

  it('leaves text without placeholders unchanged', () => {
    expect(renderTemplate('plain { text } {x}', {})).toBe('plain { text } {x}');
  });

  it('throws on unknown variables and lists the available ones', () => {
    expect(() => renderTemplate('{{nope}}', { a: '1', b: '2' })).toThrow(TemplateError);
    expect(() => renderTemplate('{{nope}}', { a: '1', b: '2' })).toThrow(/unknown variable "nope".*a, b/);
    expect(() => renderTemplate('{{{nope}}}', {})).toThrow(/nope/);
  });

  it('does not resolve inherited object properties as variables', () => {
    expect(() => renderTemplate('{{constructor}}', {})).toThrow(TemplateError);
    expect(() => renderTemplate('{{toString}}', {})).toThrow(TemplateError);
  });

  it('the default layout only uses variables the site provides', () => {
    const vars = Object.fromEntries(
      ['lang', 'siteTitle', 'pageTitle', 'title', 'description', 'base', 'head', 'nav', 'content'].map((k) => [k, k]),
    );
    const out = renderTemplate(DEFAULT_LAYOUT, vars);
    expect(out).toContain('<!doctype html>');
    expect(out).toContain('<html lang="lang">');
  });
});
