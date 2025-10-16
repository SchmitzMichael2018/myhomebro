// frontend/src/hooks/useHomeowners.js
// v2025-10-15 use customers-first cache (with /homeowners alias)

import { useEffect, useState } from "react";
import api from "@/api";
import { loadHomeowners, labelForPerson, clearHomeownersCache } from "@/lib/homeownersCache";

export function useHomeowners({ force = false } = {}) {
  const [data, setData] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    loadHomeowners(api, { force, signal: controller.signal })
      .then((list) => setData(Array.isArray(list) ? list : []))
      .catch((e) => {
        if (e?.name !== "CanceledError" && e?.name !== "AbortError") setError(e);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [force]);

  return { data, loading, error, labelForPerson, clearHomeownersCache };
}

export default useHomeowners;
