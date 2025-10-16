// src/lib/homeowners.js
// v2025-10-15 customers-first + robust fallback + normalization + caching
// Notes:
// - Keeps the same export surface (getHomeownersOnce, listHomeowners, getHomeowner, create..., update..., delete..., search...)
// - Prefers /api/customers/ (your posted payload), then /api/projects/customers/, then /api/projects/homeowners/
// - Normalizes all shapes to { id, first_name, last_name, full_name, email, ... }

import api from "@/api";

let _cache = null;
let _ts = 0;
let _inflight = null;
let _controller = null;

const TTL_MS = 5 * 60 * 1000; // 5 minutes

const pickArray = (raw) =>
  Array.isArray(raw?.results) ? raw.results : Array.isArray(raw) ? raw : [];

// ---- Normalizers ----
function normalizeCustomer(rec) {
  if (!rec || typeof rec !== "object") return null;
  const id = rec.id ?? rec.pk;
  if (!id) return null;
  const full_name = String(rec.full_name ?? rec.name ?? "").trim();
  const email = String(rec.email ?? "").trim();
  const phone = String(rec.phone_number ?? rec.phone ?? "").trim();
  const street = String(rec.street_address ?? rec.street ?? "").trim();
  const address_line2 = String(rec.address_line_2 ?? rec.address_line2 ?? "").trim();
  const city = String(rec.city ?? "").trim();
  const state = String(rec.state ?? "").trim();
  const zip = String(rec.zip_code ?? rec.zip ?? "").trim();

  let first_name = "", last_name = "";
  if (full_name.includes(" ")) {
    const parts = full_name.split(/\s+/);
    first_name = parts.slice(0, -1).join(" ");
    last_name = parts.slice(-1)[0];
  } else {
    first_name = full_name;
  }

  return {
    id,
    first_name,
    last_name,
    full_name,
    email,
    phone,
    street,
    address_line2,
    city,
    state,
    zip,
    _src: "customers",
  };
}

function normalizeHomeowner(rec) {
  if (!rec || typeof rec !== "object") return null;
  const id = rec.id ?? rec.pk;
  if (!id) return null;
  const first_name = String(rec.first_name ?? rec.firstName ?? "").trim();
  const last_name  = String(rec.last_name ?? rec.lastName ?? "").trim();
  const email = String(rec.email ?? "").trim();
  const full_name = String(
    rec.full_name ?? rec.fullName ?? rec.name ?? [first_name, last_name].filter(Boolean).join(" ")
  ).trim();
  return { id, first_name, last_name, full_name, email, _src: "homeowners" };
}

function sortPeople(list) {
  list.sort((a, b) =>
    (a.full_name || a.last_name || a.email || `id:${a.id}`).localeCompare(
      b.full_name || b.last_name || b.email || `id:${b.id}`
    )
  );
  return list;
}

async function _loadPeople({ signal, params } = {}) {
  // 1) /api/customers/
  try {
    const { data } = await api.get("/customers/", { signal, params });
    const list = sortPeople(pickArray(data).map(normalizeCustomer).filter(Boolean));
    if (list.length) return list;
  } catch {}

  // 2) /api/projects/customers/
  try {
    const { data } = await api.get("/projects/customers/", { signal, params });
    const list = sortPeople(pickArray(data).map(normalizeCustomer).filter(Boolean));
    if (list.length) return list;
  } catch {}

  // 3) /api/projects/homeowners/
  try {
    const { data } = await api.get("/projects/homeowners/", { signal, params });
    const list = sortPeople(pickArray(data).map(normalizeHomeowner).filter(Boolean));
    if (list.length) return list;
  } catch {}

  return [];
}

/**
 * Return the customers/homeowners list with TTL cache and inflight dedupe.
 * Keeps the existing function name for backward compatibility.
 */
export async function getHomeownersOnce({ signal, params } = {}) {
  const now = Date.now();

  if (_cache && now - _ts < TTL_MS) return _cache;
  if (_inflight) return _inflight;

  _controller?.abort();
  _controller = new AbortController();
  if (signal) {
    const onAbort = () => _controller.abort();
    signal.addEventListener("abort", onAbort, { once: true });
  }

  _inflight = (async () => {
    try {
      const list = await _loadPeople({ signal: _controller.signal, params });
      _cache = list;
      _ts = Date.now();
      return list;
    } catch (err) {
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
 * These now operate on customers first, then fall back.
 * ------------------------- */

export async function listHomeowners(params = {}) {
  const list = await _loadPeople({ params });
  return list;
}

export async function getHomeowner(id) {
  if (!id) throw new Error("getHomeowner: id is required");
  // Prefer customers lookup
  try {
    const { data } = await api.get(`/customers/${id}/`);
    return normalizeCustomer(data) || data;
  } catch {
    try {
      const { data } = await api.get(`/projects/customers/${id}/`);
      return normalizeCustomer(data) || data;
    } catch {
      const { data } = await api.get(`/projects/homeowners/${id}/`);
      return normalizeHomeowner(data) || data;
    }
  }
}

// If you actually create/update in customers, keep these or adjust to your backend behavior.
// If not needed, you can leave them as no-ops or throw unsupported.
export async function createHomeowner(payload) {
  const { data } = await api.post("/customers/", payload);
  invalidateHomeownersCache();
  return data;
}

export async function updateHomeowner(id, payload) {
  if (!id) throw new Error("updateHomeowner: id is required");
  const { data } = await api.patch(`/customers/${id}/`, payload);
  invalidateHomeownersCache();
  return data;
}

export async function deleteHomeowner(id) {
  if (!id) throw new Error("deleteHomeowner: id is required");
  await api.delete(`/customers/${id}/`);
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
