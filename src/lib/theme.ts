export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'novasdr.theme';

export function getStoredTheme(): ThemePreference | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  return null;
}

export function setStoredTheme(value: ThemePreference): void {
  window.localStorage.setItem(STORAGE_KEY, value);
}

export function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveTheme(value: ThemePreference): 'light' | 'dark' {
  return value === 'system' ? getSystemTheme() : value;
}

export function applyTheme(value: ThemePreference): void {
  const resolved = resolveTheme(value);
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
}

