import { useCallback, useEffect, useState } from "react";

import { listCaptures } from "../api/captures.js";

export function useCaptures(filters = {}, { enabled = true } = {}) {
  const [data, setData] = useState({
    count: 0,
    next: null,
    previous: null,
    results: [],
  });
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");

  const status = filters.status || "";
  const type = filters.type || "";
  const search = filters.search || "";
  const page = filters.page || 1;

  const reload = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await listCaptures({ status, type, search, page });
      setData({
        count: result?.count || 0,
        next: result?.next || null,
        previous: result?.previous || null,
        results: Array.isArray(result?.results) ? result.results : [],
      });
    } catch (requestError) {
      setError(
        requestError?.response?.data?.detail ||
          "Capture Inbox could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }, [enabled, page, search, status, type]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { ...data, loading, error, reload };
}
