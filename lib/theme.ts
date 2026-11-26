'use client';

import { useEffect, useSyncExternalStore } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = 'nodal_theme';
const THEME_EVENT = 'nodal-theme-change';

function subscribeTheme(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  window.addEventListener(THEME_EVENT, callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(THEME_EVENT, callback);
  };
}

function getThemeSnapshot(): ThemeMode {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved;
    }
  } catch {

  }
  return 'dark';
}

function getThemeServerSnapshot(): ThemeMode {
  return 'dark';
}

export function saveThemeMode(nextMode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextMode);
    window.dispatchEvent(new Event(THEME_EVENT));
  } catch {

  }
}

export function useThemeMode(): ThemeMode {
  const themeMode = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getThemeServerSnapshot
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const shouldUseDark =
        themeMode === 'dark' || (themeMode === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', shouldUseDark);
    };

    applyTheme();

    if (themeMode === 'system') {
      media.addEventListener('change', applyTheme);
      return () => media.removeEventListener('change', applyTheme);
    }
    return undefined;
  }, [themeMode]);

  return themeMode;
}
