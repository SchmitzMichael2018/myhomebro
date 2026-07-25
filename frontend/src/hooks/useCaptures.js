import { useCallback, useEffect, useState } from "react";

import {
  getCapture,
  getCaptureSummary,
  listCaptures,
} from "../api/captures.js";

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

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;
    const onSaved = () => reload();
    window.addEventListener("mhb:capture-saved", onSaved);
    return () => window.removeEventListener("mhb:capture-saved", onSaved);
  }, [enabled, reload]);

  return { ...data, loading, error, reload };
}

export function useCaptureSummary({ enabled = true } = {}) {
  const [summary, setSummary] = useState({
    pending: 0,
    needs_review: 0,
    applied: 0,
    failed: 0,
    archived: 0,
    today: 0,
  });
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError("");
    try {
      setSummary((await getCaptureSummary()) || {});
    } catch (requestError) {
      setError(
        requestError?.response?.data?.detail ||
          "Capture summary could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { summary, loading, error, reload };
}

export function useCapture(captureId, { enabled = true } = {}) {
  const [capture, setCapture] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!enabled || !captureId) return;
    setLoading(true);
    setError("");
    try {
      setCapture(await getCapture(captureId));
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || "Capture could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [captureId, enabled]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { capture, loading, error, reload };
}
