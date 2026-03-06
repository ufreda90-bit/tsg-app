export type ThemeMode = 'system' | 'light' | 'dark';
export type EffectiveTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'app.theme.mode';
const DARK_MODE_MEDIA_QUERY = '(prefers-color-scheme: dark)';

function normalizeThemeMode(value: string | null | undefined): ThemeMode | null {
  if (value === 'system' || value === 'light' || value === 'dark') return value;
  return null;
}

export function getStoredTheme(): ThemeMode | null {
  if (typeof window === 'undefined') return null;
  return normalizeThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
}

export function setStoredTheme(mode: ThemeMode) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_STORAGE_KEY, mode);
}

export function getSystemTheme(): EffectiveTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia(DARK_MODE_MEDIA_QUERY).matches ? 'dark' : 'light';
}

function resolveTheme(mode: ThemeMode): EffectiveTheme {
  return mode === 'system' ? getSystemTheme() : mode;
}

function setDocumentTheme(theme: EffectiveTheme) {
  if (typeof document === 'undefined') return;
  if (theme === 'dark') {
    document.documentElement.dataset.theme = 'dark';
    return;
  }
  delete document.documentElement.dataset.theme;
}

export function applyTheme(mode: ThemeMode): EffectiveTheme {
  const effectiveTheme = resolveTheme(mode);
  setDocumentTheme(effectiveTheme);
  return effectiveTheme;
}

export function initializeThemeFromStorage(): ThemeMode {
  const mode = getStoredTheme() ?? 'system';
  applyTheme(mode);
  return mode;
}

export function subscribeToSystemThemeChange(listener: (nextTheme: EffectiveTheme) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }

  const media = window.matchMedia(DARK_MODE_MEDIA_QUERY);
  const onChange = () => listener(media.matches ? 'dark' : 'light');

  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }

  media.addListener(onChange);
  return () => media.removeListener(onChange);
}
