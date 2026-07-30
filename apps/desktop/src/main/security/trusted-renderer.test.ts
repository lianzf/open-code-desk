import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isTrustedRendererUrl } from './trusted-renderer';

describe('isTrustedRendererUrl', () => {
  it('accepts only the configured development origin', () => {
    expect(
      isTrustedRendererUrl(
        'http://localhost:5173/settings',
        'unused.html',
        'http://localhost:5173',
      ),
    ).toBe(true);
    expect(
      isTrustedRendererUrl(
        'http://localhost.attacker.test:5173',
        'unused.html',
        'http://localhost:5173',
      ),
    ).toBe(false);
  });

  it('accepts only the packaged renderer file', () => {
    const rendererPath = 'C:\\application\\out\\renderer\\index.html';
    const siblingPath = 'C:\\application\\out\\renderer-evil\\index.html';

    expect(isTrustedRendererUrl(pathToFileURL(rendererPath).toString(), rendererPath)).toBe(true);
    expect(isTrustedRendererUrl(pathToFileURL(siblingPath).toString(), rendererPath)).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isTrustedRendererUrl('not a URL', 'index.html')).toBe(false);
  });
});
