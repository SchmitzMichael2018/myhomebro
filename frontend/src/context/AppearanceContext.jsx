import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

export const APPEARANCE_STORAGE_KEY = "myhomebro.appearance.v1";
export const APPEARANCE_VALUES = ["system", "light", "dark"];
export const DEFAULT_APPEARANCE = "dark";
export const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

const AppearanceContext = createContext(null);

export function normalizeAppearance(value) {
  return APPEARANCE_VALUES.includes(value) ? value : DEFAULT_APPEARANCE;
}

export function readStoredAppearance(storage = globalThis?.localStorage) {
  try {
    return normalizeAppearance(storage?.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function resolveAppearance(appearance, systemDark = false) {
  const normalized = normalizeAppearance(appearance);
  if (normalized === "system") return systemDark ? "dark" : "light";
  return normalized;
}

function getSystemDark(matchMedia = globalThis?.matchMedia) {
  try {
    return Boolean(matchMedia?.(DARK_MEDIA_QUERY)?.matches);
  } catch {
    return false;
  }
}

export function subscribeToSystemAppearance(matchMedia, onChange) {
  const media = matchMedia(DARK_MEDIA_QUERY);
  const listener = (event) => onChange(Boolean(event.matches));
  onChange(Boolean(media.matches));
  media.addEventListener?.("change", listener);
  return () => media.removeEventListener?.("change", listener);
}

export function applyAppearanceToDocument(appearance, resolvedTheme, documentRef = globalThis?.document) {
  const root = documentRef?.documentElement;
  if (!root) return;
  root.dataset.mhbAppearance = normalizeAppearance(appearance);
  root.dataset.mhbTheme = resolveAppearance(resolvedTheme);
  root.style.colorScheme = resolveAppearance(resolvedTheme);
}

export function AppearanceProvider({ children }) {
  const [appearance, setAppearanceState] = useState(() => readStoredAppearance());
  const [systemDark, setSystemDark] = useState(() => getSystemDark());
  const resolvedTheme = resolveAppearance(appearance, systemDark);

  useLayoutEffect(() => {
    applyAppearanceToDocument(appearance, resolvedTheme);
  }, [appearance, resolvedTheme]);

  useEffect(() => {
    if (appearance !== "system") return undefined;
    return subscribeToSystemAppearance(window.matchMedia.bind(window), setSystemDark);
  }, [appearance]);

  useEffect(
    () => () => {
      const root = document.documentElement;
      delete root.dataset.mhbAppearance;
      delete root.dataset.mhbTheme;
      root.style.removeProperty("color-scheme");
    },
    []
  );

  const setAppearance = useCallback((nextAppearance) => {
    const normalized = normalizeAppearance(nextAppearance);
    try {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, normalized);
    } catch {
      // The in-memory choice still works when storage is unavailable.
    }
    setAppearanceState(normalized);
  }, []);

  const value = useMemo(
    () => ({ appearance, resolvedTheme, setAppearance }),
    [appearance, resolvedTheme, setAppearance]
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const context = useContext(AppearanceContext);
  if (!context) throw new Error("useAppearance must be used within AppearanceProvider");
  return context;
}
