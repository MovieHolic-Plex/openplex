import type { AnyNode } from 'domhandler';
import type { Cheerio } from 'cheerio';
import { decode } from 'entities';

/** Decode named and numeric HTML entities. */
export function htmlUnescape(input: string): string {
  return decode(input);
}

/** Remove markup and return decoded text. */
export function stripTags(html: string): string {
  return htmlUnescape(html.replace(/<[^>]+>/g, ''));
}

/** Read an attribute from a Cheerio element or an HTML fragment. */
export function extractAttr(
  source: Cheerio<AnyNode> | string,
  attrName: string,
): string | null {
  if (typeof source !== 'string') {
    return source.attr(attrName) ?? null;
  }

  const escapedName = attrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    `${escapedName}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`,
    'i',
  ).exec(source);
  if (!match) return null;

  const value = match[1];
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Extract the final numeric path segment, accepting a `p` prefix. */
export function trailingNumber(path: string): number | null {
  let pathname = path;
  try {
    pathname = new URL(path, 'https://fixture.invalid').pathname;
  } catch {
    // Preserve Dart behavior for malformed URL-like strings.
  }
  const match = /\/(?:p)?(\d+)\/?$/.exec(pathname);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function cleanText(element: Cheerio<AnyNode>): string {
  return element.text().replace(/\u00a0/g, ' ').trim();
}

export function preferredImageUrl(element: Cheerio<AnyNode>): string | null {
  return element.attr('data-src') ?? element.attr('src') ?? null;
}

export function pathSegments(href: string): string[] {
  try {
    return new URL(href, 'https://fixture.invalid').pathname
      .split('/')
      .filter(Boolean);
  } catch {
    return href.split('/').filter(Boolean);
  }
}
