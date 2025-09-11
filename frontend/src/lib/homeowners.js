// frontend/src/lib/homeowners.js
// Notes:
// - Assumes axios instance at "@/api" with baseURL "/api"
// - Endpoints below call "/homeowners/..." so final URLs resolve to "/api/homeowners/..."
// - All mutation helpers auto-invalidate the cached list.

import api from "@/api";

let _cache = null;
let _ts = 0;
let _inflight = null;
let _controller = null;

const TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Return the homeowners list with a short TTL cache and inflight dedupe.
 * If aborted, returns the last cache (if any) or [] to avoid UI explosions.
 */
export async function getHomeownersOnce({ signal, params } = {}) {
  const now = Date.now();

  if (_cache && now - _ts < TTL_MS) return _cache;
  if (_inflight) return _inflight;

  // wire up abort so external signal cancels our internal controller
  _controller?.abort();
  _controller = new AbortController();

  if (signal) {
    const onAbort = () => _controller.abort();
    signal.addEventListener("abort", onAbort, { once: true });
  }

  _inflight = (async () => {
    try {
      const { data } = await api.get("/homeowners/", {
        signal: _controller.signal,
        params,
      });
      const list = Array.isArray(data) ? data : data?.results ?? [];
      _cache = list;
      _ts = Date.now();
      return list;
    } catch (err) {
      // If request was aborted, return cache or empty array
      if (err?.name === "CanceledError" || err?.message?.includes("canceled")) {
        return _cache ?? [];
      }
      throw err;
    } finally {
      _inflight = null;
      _controller = null;
    }
  })();

  return _inflight;
}

export function invalidateHomeownersCache() {
  _cache = null;
  _ts = 0;
  _controller?.abort();
  _inflight = null;
}

/* -------------------------
 * CRUD helpers (no cache)
 * ------------------------- */

export async function listHomeowners(params = {}) {
  const { data } = await api.get("/homeowners/", { params });
  return Array.isArray(data) ? data : data?.results ?? [];
}

export async function getHomeowner(id) {
  if (!id) throw new Error("getHomeowner: id is required");
  const { data } = await api.get(`/homeowners/${id}/`);
  return data;
}

export async function createHomeowner(payload) {
  const { data } = await api.post("/homeowners/", payload);
  invalidateHomeownersCache();
  return data;
}

export async function updateHomeowner(id, payload) {
  if (!id) throw new Error("updateHomeowner: id is required");
  const { data } = await api.patch(`/homeowners/${id}/`, payload);
  invalidateHomeownersCache();
  return data;
}

export async function deleteHomeowner(id) {
  if (!id) throw new Error("deleteHomeowner: id is required");
  await api.delete(`/homeowners/${id}/`);
  invalidateHomeownersCache();
  return true;
}

export async function searchHomeowners(query, extraParams = {}) {
  return listHomeowners({ search: query, ...extraParams });
}

export default {
  getHomeownersOnce,
  invalidateHomeownersCache,
  listHomeowners,
  getHomeowner,
  createHomeowner,
  updateHomeowner,
  deleteHomeowner,
  searchHomeowners,
};
