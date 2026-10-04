import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Rendering-safety guard for the CRM.
 *
 * Customer-supplied text (names, companies, notes) is stored verbatim and
 * rendered by React, which escapes it. That is the correct defence against
 * stored XSS — and it holds only for as long as nothing introduces a sink that
 * bypasses escaping. These tests fail loudly if such a sink appears, so the
 * decision to accept markup-shaped input (rather than mangling users' names with
 * a blocklist) stays sound.
 */

const SRC = join(process.cwd(), 'src');

/** Every `.tsx` file under src/, excluding the generated Prisma client. */
function componentFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    if (entry === 'generated' || entry === 'node_modules') return [];

    if (statSync(path).isDirectory()) return componentFiles(path);

    return path.endsWith('.tsx') ? [path] : [];
  });
}

const FILES = componentFiles(SRC);

describe('escaping invariants', () => {
  it('finds the component tree (guards against a silently empty scan)', () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  it('never renders customer data as raw HTML', () => {
    const offenders = FILES.filter((file) =>
      /dangerouslySetInnerHTML|\.innerHTML\s*=/.test(readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });

  it('never builds a javascript: URL from user input', () => {
    // `mailto:` and `tel:` hrefs on the customer page are fine; a
    // `javascript:` href built from a stored value would not be.
    const offenders = FILES.filter((file) =>
      /href\s*=\s*\{?[`'"]javascript:/i.test(readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});

/**
 * Credential and PII leakage through the URL.
 *
 * Every one of these forms is progressively enhanced: React's submit handler
 * calls `preventDefault` and talks to the API. If hydration has not finished —
 * a slow connection, a blocked chunk, or a browser extension that mutates the
 * DOM before React runs — the browser falls back to a *native* GET submit,
 * which appends every field to the URL. URLs are kept in history, written to
 * access logs and can leak through the `Referer` header.
 *
 * `method="post"` closes that hole: when the handler is attached nothing
 * changes, and when it is not, the credentials travel in the request body
 * instead of the query string.
 */
describe('forms do not fall back to a native GET submit', () => {
  const FORMS = FILES.filter((file) => /<form\b/.test(readFileSync(file, 'utf8')));

  it('finds the form components (guards against an empty scan)', () => {
    expect(FORMS.length).toBeGreaterThan(3);
  });

  it.each(FORMS.map((file) => [file.replace(`${SRC}\\`, '').replace(SRC, ''), file]))(
    'declares method="post" on every <form> in %s',
    (_name, file) => {
      const source = readFileSync(file, 'utf8');
      const forms = source.match(/<form\b[\s\S]*?>/g) ?? [];

      for (const form of forms) {
        expect(form, `<form> in ${file} has no method="post"`).toMatch(/method=["']post["']/);
      }
    },
  );
});