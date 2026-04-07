import { useCallback, useEffect, useRef, useState } from "react";

export default function useAiFieldHighlights({ durationMs = 5000 } = {}) {
  const [highlights, setHighlights] = useState({});
  const timersRef = useRef(new Map());

  const clearUpdated = useCallback((keys) => {
    const list = Array.isArray(keys) ? keys : [keys];
    list.filter(Boolean).forEach((key) => {
      const timer = timersRef.current.get(key);
      if (timer) {
        clearTimeout(timer);
        timersRef.current.delete(key);
      }
    });
    setHighlights((current) => {
      const next = { ...current };
      list.filter(Boolean).forEach((key) => {
        delete next[key];
      });
      return next;
    });
  }, []);

  const markUpdated = useCallback(
    (keys, meta = {}) => {
      const list = Array.isArray(keys) ? keys : [keys];
      const validKeys = list.filter(Boolean);
      if (!validKeys.length) return;

      setHighlights((current) => {
        const next = { ...current };
        validKeys.forEach((key) => {
          next[key] = {
            label: meta.label || "AI updated",
            changedAt: Date.now(),
          };
        });
        return next;
      });

      validKeys.forEach((key) => {
        const timer = timersRef.current.get(key);
        if (timer) clearTimeout(timer);
        timersRef.current.set(
          key,
          setTimeout(() => {
            clearUpdated(key);
          }, durationMs)
        );
      });
    },
    [clearUpdated, durationMs]
  );

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  return {
    highlights,
    markUpdated,
    clearUpdated,
  };
}
