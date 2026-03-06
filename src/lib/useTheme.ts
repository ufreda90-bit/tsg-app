import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  applyTheme,
  getSystemTheme,
  getStoredTheme,
  setStoredTheme,
  subscribeToSystemThemeChange,
  type EffectiveTheme,
  type ThemeMode
} from './theme';

type ThemeContextValue = {
  mode: ThemeMode;
  effectiveTheme: EffectiveTheme;
  setMode: (mode: ThemeMode) => void;
  toggleLightDark: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => getStoredTheme() ?? 'system');
  const [effectiveTheme, setEffectiveTheme] = useState<EffectiveTheme>(() => {
    const initialMode = getStoredTheme() ?? 'system';
    return initialMode === 'system' ? getSystemTheme() : initialMode;
  });

  useEffect(() => {
    setEffectiveTheme(applyTheme(mode));
    if (mode !== 'system') return;
    return subscribeToSystemThemeChange(() => {
      setEffectiveTheme(applyTheme('system'));
    });
  }, [mode]);

  const setMode = useCallback((nextMode: ThemeMode) => {
    setStoredTheme(nextMode);
    setModeState(nextMode);
    setEffectiveTheme(applyTheme(nextMode));
  }, []);

  const toggleLightDark = useCallback(() => {
    setMode(effectiveTheme === 'dark' ? 'light' : 'dark');
  }, [effectiveTheme, setMode]);

  const value = useMemo(
    () => ({
      mode,
      effectiveTheme,
      setMode,
      toggleLightDark
    }),
    [mode, effectiveTheme, setMode, toggleLightDark]
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
