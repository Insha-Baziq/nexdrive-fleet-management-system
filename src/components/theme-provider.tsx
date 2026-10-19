"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

type ThemeName = "light" | "dark";

type ThemeContextValue = {
  resolvedTheme: ThemeName;
  setTheme: (theme: ThemeName) => void;
};

const THEME_STORAGE_KEY = "theme";
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
let activeTheme: ThemeName = "light";
const themeListeners = new Set<() => void>();

function subscribeToTheme(listener: () => void) {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}

function getThemeSnapshot() {
  return activeTheme;
}

function getServerThemeSnapshot(): ThemeName {
  return "light";
}

function updateThemeSnapshot(theme: ThemeName) {
  if (activeTheme === theme) return;
  activeTheme = theme;
  for (const listener of themeListeners) listener();
}

const ThemeContext = createContext<ThemeContextValue>({
  resolvedTheme: "light",
  setTheme: () => undefined,
});

function applyTheme(theme: ThemeName) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const resolvedTheme = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getServerThemeSnapshot);

  const setTheme = useCallback((theme: ThemeName) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme changes still apply when browser storage is unavailable.
    }
    applyTheme(theme);
    updateThemeSnapshot(theme);
  }, []);

  useIsomorphicLayoutEffect(() => {
    let initialTheme: ThemeName = "light";
    try {
      const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (storedTheme === "dark" || storedTheme === "light") initialTheme = storedTheme;
    } catch {
      // Keep the light default when browser storage is unavailable.
    }
    applyTheme(initialTheme);
    updateThemeSnapshot(initialTheme);

    function syncTheme(event: StorageEvent) {
      if (event.key !== THEME_STORAGE_KEY) return;
      const nextTheme = event.newValue === "dark" ? "dark" : "light";
      applyTheme(nextTheme);
      updateThemeSnapshot(nextTheme);
    }

    window.addEventListener("storage", syncTheme);
    return () => window.removeEventListener("storage", syncTheme);
  }, []);

  const value = useMemo(() => ({ resolvedTheme, setTheme }), [resolvedTheme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
