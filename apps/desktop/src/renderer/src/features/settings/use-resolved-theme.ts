import { useEffect, useState } from 'react';

import { useAppSettingsStore } from './app-settings.store';

export function useResolvedTheme(): 'dark' | 'light' {
  const theme = useAppSettingsStore((state) => state.settings.theme);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}
