'use client';

import { useEffect } from 'react';
import {
  applyTheme,
  getStoredTheme,
  normalizeTheme,
  THEME_STORAGE_KEY,
} from '@/lib/theme';

export function ThemeManager() {
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    applyTheme(getStoredTheme());

    const handleMediaChange = () => {
      if (getStoredTheme() === 'system') {
        applyTheme('system');
      }
    };

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) {
        applyTheme(normalizeTheme(event.newValue));
      }
    };

    mediaQuery.addEventListener('change', handleMediaChange);
    window.addEventListener('storage', handleStorageChange);

    return () => {
      mediaQuery.removeEventListener('change', handleMediaChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  return null;
}
