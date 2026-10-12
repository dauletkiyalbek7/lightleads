"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_THEME, isTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === DEFAULT_THEME) delete root.dataset.theme;
  else root.dataset.theme = theme;
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (isTheme(stored)) setThemeState(stored);
    } catch {
      /* хранилище недоступно — остаётся тема по умолчанию */
    }
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* приватный режим: тема применится до перезагрузки */
    }
  }, []);

  return [theme, setTheme];
}
