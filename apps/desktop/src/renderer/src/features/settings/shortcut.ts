export interface ShortcutKeyboardEvent {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

type Platform = 'darwin' | 'other';

const keyAliases: Readonly<Record<string, string>> = {
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
};

export function matchesShortcut(
  event: ShortcutKeyboardEvent,
  shortcut: string,
  platform: Platform = navigator.platform.toLocaleLowerCase('en-US').includes('mac')
    ? 'darwin'
    : 'other',
): boolean {
  const tokens = shortcut.split('+');
  const keyToken = tokens.at(-1);
  if (keyToken === undefined) {
    return false;
  }
  const modifiers = new Set(tokens.slice(0, -1));
  const controlPressed = platform === 'darwin' ? event.metaKey : event.ctrlKey;
  const expectedKey = keyAliases[keyToken] ?? keyToken;
  const expectedMeta = modifiers.has('Cmd') || (platform === 'darwin' && modifiers.has('Ctrl'));
  const expectedControl = platform === 'darwin' ? false : modifiers.has('Ctrl');

  return (
    controlPressed === modifiers.has('Ctrl') &&
    event.ctrlKey === expectedControl &&
    event.metaKey === expectedMeta &&
    event.altKey === modifiers.has('Alt') &&
    event.shiftKey === modifiers.has('Shift') &&
    event.key.toLocaleUpperCase('en-US') === expectedKey.toLocaleUpperCase('en-US')
  );
}
