import { useCallback, useEffect, useState } from "react";

import {
  getCaptureArtifacts,
  getCapture,
  getCaptureSummary,
  getCaptureTimeline,
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
  const cursor = filters.cursor || "";
  const creator = filters.creator || "";
  const dateFrom = filters.date_from || "";
  const dateTo = filters.date_to || "";
  const hasDuplicates = filters.has_duplicates || "";
  const hasFollowUp = filters.has_follow_up || "";
  const sort = filters.sort || "newest";

  const reload = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await listCaptures({
        status,
        type,
        search,
        cursor: cursor || undefined,
        creator: creator || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        has_duplicates: hasDuplicates || undefined,
        has_follow_up: hasFollowUp || undefined,
        sort,
      });
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
  }, [
    cursor, creator, dateFrom, dateTo, enabled, hasDuplicates,
    hasFollowUp, search, sort, status, type,
  ]);

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

function useCaptureSection(captureId, loader, fallbackMessage, { enabled = true } = {}) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    if (!enabled || !captureId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await loader(captureId);
      setResults(Array.isArray(response?.results) ? response.results : []);
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || fallbackMessage);
    } finally {
      setLoading(false);
    }
  }, [captureId, enabled, fallbackMessage, loader]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { results, loading, error, reload };
}

export function useCaptureTimeline(captureId, options) {
  return useCaptureSection(
    captureId, getCaptureTimeline, "Capture history could not be loaded.", options
  );
}

export function useCaptureArtifacts(captureId, options) {
  return useCaptureSection(
    captureId, getCaptureArtifacts, "Capture files could not be loaded.", options
  );
}
