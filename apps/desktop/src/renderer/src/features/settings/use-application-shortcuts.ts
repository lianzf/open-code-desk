import { useEffect } from 'react';
import type { AppSettings } from '@open-code-desk/ipc-contracts';

import { matchesShortcut } from './shortcut';

type ShortcutAction = keyof AppSettings['shortcuts'];

export function useApplicationShortcuts(
  shortcuts: AppSettings['shortcuts'],
  handlers: Partial<Record<ShortcutAction, () => void>>,
): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      for (const [action, handler] of Object.entries(handlers) as Array<
        [ShortcutAction, (() => void) | undefined]
      >) {
        if (handler !== undefined && matchesShortcut(event, shortcuts[action])) {
          event.preventDefault();
          event.stopPropagation();
          handler();
          return;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [handlers, shortcuts]);
}
