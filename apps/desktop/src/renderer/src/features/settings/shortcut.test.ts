import { describe, expect, it } from 'vitest';

import { matchesShortcut, type ShortcutKeyboardEvent } from './shortcut';

function keyboardEvent(
  key: string,
  overrides: Partial<ShortcutKeyboardEvent> = {},
): ShortcutKeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    key,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe('keyboard shortcut matching', () => {
  it('matches Ctrl on Windows/Linux and Command on macOS', () => {
    expect(matchesShortcut(keyboardEvent('`', { ctrlKey: true }), 'Ctrl+Backquote', 'other')).toBe(
      true,
    );
    expect(matchesShortcut(keyboardEvent('`', { metaKey: true }), 'Ctrl+Backquote', 'darwin')).toBe(
      true,
    );
    expect(
      matchesShortcut(
        keyboardEvent('`', { ctrlKey: true, metaKey: true }),
        'Ctrl+Backquote',
        'darwin',
      ),
    ).toBe(false);
  });

  it('requires the exact configured modifiers and key', () => {
    expect(
      matchesShortcut(
        keyboardEvent('g', { ctrlKey: true, shiftKey: true }),
        'Ctrl+Shift+G',
        'other',
      ),
    ).toBe(true);
    expect(matchesShortcut(keyboardEvent('g', { ctrlKey: true }), 'Ctrl+Shift+G', 'other')).toBe(
      false,
    );
    expect(
      matchesShortcut(
        keyboardEvent('g', { altKey: true, ctrlKey: true, shiftKey: true }),
        'Ctrl+Shift+G',
        'other',
      ),
    ).toBe(false);
  });
});
