// frontend/src/api/subaccounts.js
// v2026-01-04 — unified subaccounts API helpers (backward compatible)

import api from "../api"; // axios instance (matches TeamPage.jsx)

/**
 * Internal helper: normalize list responses that might come as
 * array OR { results: [...] }
 */
function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;
  return [];
}

/**
 * NEW name (preferred): fetchSubaccounts
 */
export async function fetchSubaccounts(params = {}) {
  const res = await api.get("/projects/subaccounts/", { params });
  return res.data;
}

/**
 * BACKWARD COMPAT: listSubaccounts
 * Some components import { listSubaccounts } from "../api/subaccounts"
 */
export async function listSubaccounts(params = {}) {
  const data = await fetchSubaccounts(params);
  return data;
}

/**
 * Convenience: return normalized array directly (useful in UI dropdowns)
 */
export async function listSubaccountsArray(params = {}) {
  const data = await fetchSubaccounts(params);
  return normalizeList(data);
}

/**
 * Create a subaccount
 */
export async function createSubaccount(payload) {
  const res = await api.post("/projects/subaccounts/", payload);
  return res.data;
}

/**
 * Patch a subaccount
 */
export async function patchSubaccount(id, payload) {
  const res = await api.patch(`/projects/subaccounts/${id}/`, payload);
  return res.data;
}

/**
 * Delete a subaccount
 */
export async function deleteSubaccount(id) {
  const res = await api.delete(`/projects/subaccounts/${id}/`);
  return res.data; // 204 usually returns empty
}
