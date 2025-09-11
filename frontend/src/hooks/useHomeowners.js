// src/hooks/useHomeowners.js (or wherever)
import { useEffect, useState } from "react";
import { loadHomeowners } from "@/lib/homeownersCache";
import api from "@/api";

export function useHomeowners() {
  const [data, setData] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    loadHomeowners(api, { signal: controller.signal })
      .then(setData)
      .catch((e) => {
        if (e.name !== "CanceledError" && e.name !== "AbortError") setError(e);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  // optional manual refresh: loadHomeowners(api, { force: true })
  return { data, error, loading };
}
