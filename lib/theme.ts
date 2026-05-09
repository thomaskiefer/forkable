export type Theme = 'light' | 'system' | 'dark';

export const THEME_STORAGE_KEY = 'theme';

export function normalizeTheme(value: string | null): Theme {
  return value === 'light' || value === 'dark' || value === 'system'
    ? value
    : 'dark';
}

export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  return normalizeTheme(localStorage.getItem(THEME_STORAGE_KEY));
}

export function applyTheme(theme: Theme) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;
  const resolvedTheme =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;

  root.classList.remove('light', 'dark');
  root.classList.add(resolvedTheme);
  root.style.colorScheme = resolvedTheme;
}
