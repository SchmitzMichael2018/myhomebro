'use client';

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Persistent state backed by localStorage.
 * @returns [value, setValue, clear]
 */
export default function usePersistentState(key, initialValue) {
  const isBrowser = typeof window !== "undefined";
  const initial = useRef(
    isBrowser
      ? (() => {
          try {
            const raw = window.localStorage.getItem(key);
            return raw == null ? initialValue : JSON.parse(raw);
          } catch {
            return initialValue;
          }
        })()
      : initialValue
  );

  const [value, setValue] = useState(initial.current);

  useEffect(() => {
    if (!isBrowser) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore quota / private mode errors
    }
  }, [isBrowser, key, value]);

  const clear = useCallback(() => {
    if (isBrowser) {
      try {
        window.localStorage.removeItem(key);
      } catch {}
    }
    setValue(initialValue);
  }, [isBrowser, initialValue, key]);

  return [value, setValue, clear];
}
