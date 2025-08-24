// src/auth.js

/**
 * Robust JWT auth helper for MyHomeBro frontend
 * - LocalStorage-backed session (access + refresh)
 * - Auto-refresh on 401 (singleton refresh, queued callers)
 * - Token parsing (exp), expiry checks, and multi-tab sync
 * - Friendly helpers: login, registerContractor, fetchWithAuth, logout
 */

const ACCESS_TOKEN_KEY = "access";
const REFRESH_TOKEN_KEY = "refresh";
const AUTH_CHANGED_EVENT = "myhomebro:auth-changed"; // custom broadcast within tab
const BASE_URL = ""; // set to "" if your frontend is served by Django; else e.g. "https://www.myhomebro.com"

// ───────────────────────────────────────────────────────────────────────────────
// Storage helpers (guard against SSR or storage errors gracefully)
// ───────────────────────────────────────────────────────────────────────────────
function safeGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key, val) {
  try {
    window.localStorage.setItem(key, val);
  } catch {}
}
function safeRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {}
}

// ───────────────────────────────────────────────────────────────────────────────
// Public getters/setters
// ───────────────────────────────────────────────────────────────────────────────
export function getAccessToken() {
  return safeGet(ACCESS_TOKEN_KEY);
}
export function getRefreshToken() {
  return safeGet(REFRESH_TOKEN_KEY);
}
export function setAccessToken(token) {
  if (typeof token === "string") {
    safeSet(ACCESS_TOKEN_KEY, token);
    broadcastAuthChange();
  }
}
export function setRefreshToken(token) {
  if (typeof token === "string") {
    safeSet(REFRESH_TOKEN_KEY, token);
    broadcastAuthChange();
  }
}
export function clearSession() {
  safeRemove(ACCESS_TOKEN_KEY);
  safeRemove(REFRESH_TOKEN_KEY);
  broadcastAuthChange();
}

// ───────────────────────────────────────────────────────────────────────────────
/** Minimal JWT parse (no crypto). Returns { header, payload, signature, raw } or null */
export function parseJwt(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    const header = JSON.parse(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")));
    return { header, payload, signature: parts[2], raw: token };
  } catch {
    return null;
  }
}
/** Returns epoch seconds (number) or null */
export function getAccessExp() {
  const tok = getAccessToken();
  const parsed = parseJwt(tok);
  return parsed?.payload?.exp ?? null;
}
export function isExpired(expSeconds) {
  if (!expSeconds) return true;
  const now = Math.floor(Date.now() / 1000);
  return expSeconds <= now;
}
export function willExpireWithinSeconds(expSeconds, within = 60) {
  if (!expSeconds) return true;
  const now = Math.floor(Date.now() / 1000);
  return expSeconds - now <= within;
}

// ───────────────────────────────────────────────────────────────────────────────
// Internal: auth change broadcast (same tab) + multi-tab sync
// ───────────────────────────────────────────────────────────────────────────────
function broadcastAuthChange() {
  try {
    window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
  } catch {}
}
// Cross-tab sync: when another tab changes tokens, react here too
window.addEventListener("storage", (e) => {
  if (e.key === ACCESS_TOKEN_KEY || e.key === REFRESH_TOKEN_KEY) {
    broadcastAuthChange();
  }
});

// Allow consumers to subscribe to auth changes
const authChangeHandlers = new Set();
export function onAuthChange(handler) {
  if (typeof handler !== "function") return () => {};
  authChangeHandlers.add(handler);
  const listener = () => handler({ access: getAccessToken(), refresh: getRefreshToken() });
  window.addEventListener(AUTH_CHANGED_EVENT, listener);
  // fire once on subscribe
  handler({ access: getAccessToken(), refresh: getRefreshToken() });
  return () => {
    authChangeHandlers.delete(handler);
    window.removeEventListener(AUTH_CHANGED_EVENT, listener);
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// Login / Register / Logout
// ───────────────────────────────────────────────────────────────────────────────
export async function login({ email, password }) {
  const url = `${BASE_URL}/api/auth/login/`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await safeJson(resp);

  if (!resp.ok) {
    const msg = extractErrorMessage(data) || "Login failed.";
    throw new Error(msg);
  }
  if (data?.access) setAccessToken(data.access);
  if (data?.refresh) setRefreshToken(data.refresh);
  return data;
}

export async function registerContractor({ email, password, first_name = "", last_name = "", phone_number = "" }) {
  const url = `${BASE_URL}/api/accounts/auth/contractor-register/`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, first_name, last_name, phone_number }),
  });
  const data = await safeJson(resp);

  if (!resp.ok) {
    const msg = extractErrorMessage(data) || "Registration failed.";
    throw new Error(msg);
  }
  // Your API returns { access, refresh } in the registration response.
  if (data?.access) setAccessToken(data.access);
  if (data?.refresh) setRefreshToken(data.refresh);
  return data;
}

export function logout(redirectTo = "/signin") {
  clearSession();
  try {
    window.location.href = redirectTo;
  } catch {
    // noop
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Token refresh logic (singleton, queued callers, no thundering herd)
// ───────────────────────────────────────────────────────────────────────────────
let refreshPromise = null;

export async function refreshAccessToken() {
  const refresh = getRefreshToken();
  if (!refresh) throw new Error("No refresh token found.");

  // If a refresh is already in progress, await it
  if (refreshPromise) return refreshPromise;

  const doRefresh = async () => {
    const url = `${BASE_URL}/api/auth/refresh/`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });
    const data = await safeJson(resp);

    if (!resp.ok || !data?.access) {
      // Refresh invalid → hard logout
      clearSession();
      throw new Error(extractErrorMessage(data) || "Failed to refresh access token.");
    }
    setAccessToken(data.access);
    return data.access;
  };

  refreshPromise = doRefresh()
    .catch((e) => {
      throw e;
    })
    .finally(() => {
      // allow subsequent refreshes
      refreshPromise = null;
    });

  return refreshPromise;
}

// ───────────────────────────────────────────────────────────────────────────────
// fetchWithAuth: attaches Bearer, auto-refreshes once on 401, retries request
// Usage: const res = await fetchWithAuth("/api/projects/…", { method: "GET" });
// ───────────────────────────────────────────────────────────────────────────────
export async function fetchWithAuth(input, init = {}) {
  const url = input.startsWith("http") ? input : `${BASE_URL}${input}`;
  let access = getAccessToken();

  // If access token is near expiry, proactively refresh
  const exp = getAccessExp();
  if (!access || willExpireWithinSeconds(exp, 20)) {
    try {
      access = await refreshAccessToken();
    } catch {
      // cannot refresh → proceed without token (will likely 401)
      access = null;
    }
  }

  const resp1 = await fetch(url, attachAuth(init, access));
  if (resp1.status !== 401) return resp1;

  // Only try one refresh on 401
  try {
    const newAccess = await refreshAccessToken();
    return fetch(url, attachAuth(init, newAccess));
  } catch {
    // Still unauthorized → logout or bubble up
    return resp1; // caller can handle 401 & redirect
  }
}

// Helper to attach Authorization header immutably
function attachAuth(init, accessToken) {
  const headers = new Headers(init.headers || {});
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (!headers.has("Content-Type") && needsJsonContentType(init)) {
    headers.set("Content-Type", "application/json");
  }
  return { ...init, headers };
}

function needsJsonContentType(init) {
  const method = (init.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return false;
  // If body is a plain object or string likely JSON, ensure header
  return !(init.body instanceof FormData);
}

// ───────────────────────────────────────────────────────────────────────────────
// Utilities
// ───────────────────────────────────────────────────────────────────────────────
async function safeJson(resp) {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

/** Extract a friendly error message from DRF-style payloads */
function extractErrorMessage(data) {
  if (!data) return null;

  // DRF field errors: { email: ["..."], password: ["..."], non_field_errors: ["..."] }
  const candidates = [];

  if (typeof data.detail === "string") candidates.push(data.detail);
  if (Array.isArray(data) && data.length && typeof data[0] === "string") candidates.push(data[0]);

  for (const key of ["email", "password", "non_field_errors"]) {
    const v = data[key];
    if (Array.isArray(v) && v.length && typeof v[0] === "string") candidates.push(v[0]);
  }

  // Fallback to first string we find
  return candidates.find(Boolean) || null;
}
