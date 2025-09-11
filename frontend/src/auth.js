// frontend/src/auth.js
/**
 * Robust JWT auth helper for MyHomeBro frontend
 * - LocalStorage or SessionStorage (setRememberMe)
 * - Multi-endpoint login + refresh fallbacks (Djoser / SimpleJWT / custom)
 * - Auto-refresh on 401 (singleton refresh, queued callers)
 * - Token parsing (exp), expiry checks, and multi-tab sync
 * - Helpers: login, registerContractor, fetchWithAuth, logout, onAuthChange
 *
 * NOTE: If you know your exact backend endpoints, set AUTH_ENDPOINTS below.
 */

/* ============================ Config ============================ */

const ACCESS_TOKEN_KEY = "access";
const REFRESH_TOKEN_KEY = "refresh";
const AUTH_CHANGED_EVENT = "myhomebro:auth-changed";
const BASE_URL = ""; // same-origin; set to "https://www.myhomebro.com" if hosting separately

// You can override these at runtime via window.__MYHOMEBRO_AUTH_ENDPOINTS__
const DEFAULT_AUTH_ENDPOINTS = {
  // Order matters; we try each in sequence until one succeeds
  login: [
    { url: "/accounts/token/", payload: (e, p) => ({ email: e, password: p }) },        // custom
    { url: "/auth/jwt/create/", payload: (e, p) => ({ email: e, password: p }) },       // Djoser (email)
    { url: "/token/", payload: (e, p) => ({ username: e, password: p }) },              // SimpleJWT default
    { url: "/auth/login/", payload: (e, p) => ({ email: e, password: p }) },            // custom legacy
  ],
  refresh: [
    { url: "/accounts/token/refresh/" },  // custom
    { url: "/auth/jwt/refresh/" },        // Djoser
    { url: "/token/refresh/" },           // SimpleJWT default
    { url: "/auth/refresh/" },            // custom legacy
  ],
  registerContractor: "/accounts/auth/contractor-register/", // returns {access, refresh}
};

// If the backend uses different paths, define window.__MYHOMEBRO_AUTH_ENDPOINTS__ = { ... } before loading this file.

/* ====================== Storage (local/session) ====================== */

let _useSession = false; // default: localStorage
export function setRememberMe(remember) {
  _useSession = !remember;
  broadcastAuthChange();
}

function currentStorage() {
  try {
    return _useSession ? window.sessionStorage : window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
}
function otherStorage() {
  try {
    return _useSession ? window.localStorage : window.sessionStorage;
  } catch {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
}
function safeGet(key) {
  try {
    const s = currentStorage().getItem(key);
    if (s != null) return s;
    // fallback: read from the other storage if present
    return otherStorage().getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key, val) {
  try {
    currentStorage().setItem(key, val);
  } catch {}
}
function safeRemove(key) {
  try { window.localStorage.removeItem(key); } catch {}
  try { window.sessionStorage.removeItem(key); } catch {}
}

/* ====================== Public token helpers ====================== */

export function getAccessToken() { return safeGet(ACCESS_TOKEN_KEY); }
export function getRefreshToken() { return safeGet(REFRESH_TOKEN_KEY); }
export function setAccessToken(token) { if (typeof token === "string") { safeSet(ACCESS_TOKEN_KEY, token); broadcastAuthChange(); } }
export function setRefreshToken(token) { if (typeof token === "string") { safeSet(REFRESH_TOKEN_KEY, token); broadcastAuthChange(); } }
export function clearSession() { safeRemove(ACCESS_TOKEN_KEY); safeRemove(REFRESH_TOKEN_KEY); broadcastAuthChange(); }

/* ========================== JWT utilities ========================== */

export function parseJwt(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const decode = (b64) => JSON.parse(atob(b64.replace(/-/g, "+").replace(/_/g, "/")));
    return { header: decode(parts[0]), payload: decode(parts[1]), signature: parts[2], raw: token };
  } catch { return null; }
}
export function getAccessExp() {
  const tok = getAccessToken();
  return parseJwt(tok)?.payload?.exp ?? null;
}
export function isExpired(expSeconds) {
  if (!expSeconds) return true;
  return expSeconds <= Math.floor(Date.now() / 1000);
}
export function willExpireWithinSeconds(expSeconds, within = 60) {
  if (!expSeconds) return true;
  const now = Math.floor(Date.now() / 1000);
  return (expSeconds - now) <= within;
}

/* ===================== Broadcast + multi-tab sync ===================== */

function broadcastAuthChange() {
  try { window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT)); } catch {}
}
export function onAuthChange(handler) {
  if (typeof handler !== "function") return () => {};
  const listener = () => handler({ access: getAccessToken(), refresh: getRefreshToken() });
  window.addEventListener(AUTH_CHANGED_EVENT, listener);
  // fire immediately
  handler({ access: getAccessToken(), refresh: getRefreshToken() });
  return () => window.removeEventListener(AUTH_CHANGED_EVENT, listener);
}
window.addEventListener("storage", (e) => {
  if (e.key === ACCESS_TOKEN_KEY || e.key === REFRESH_TOKEN_KEY) broadcastAuthChange();
});

/* ===================== Endpoint helpers (multi-try) ===================== */

function endpoints() {
  // Allow runtime override
  const override = (typeof window !== "undefined" && window.__MYHOMEBRO_AUTH_ENDPOINTS__) || {};
  const merged = { ...DEFAULT_AUTH_ENDPOINTS, ...override };
  // normalize login entries to {url, payloadFn}
  merged.login = (merged.login || []).map((x) =>
    typeof x === "string" ? { url: x, payload: (e, p) => ({ email: e, password: p }) } : x
  );
  merged.refresh = (merged.refresh || []).map((x) => (typeof x === "string" ? { url: x } : x));
  return merged;
}
function apiUrl(path) {
  return path.startsWith("http") ? path : `${BASE_URL}/api${path.startsWith("/") ? "" : "/"}${path}`;
}
async function safeJson(resp) { try { return await resp.json(); } catch { return null; } }
function pickTokens(data) {
  if (!data || typeof data !== "object") return { access: "", refresh: "" };
  return {
    access: data.access || data.access_token || data.token || "",
    refresh: data.refresh || data.refresh_token || "",
  };
}
function extractErrorMessage(data) {
  if (!data) return null;
  const c = [];
  if (typeof data.detail === "string") c.push(data.detail);
  if (Array.isArray(data) && data[0]) c.push(String(data[0]));
  for (const k of ["email", "password", "non_field_errors", "username"]) {
    const v = data[k];
    if (Array.isArray(v) && v[0]) c.push(String(v[0]));
  }
  return c.find(Boolean) || null;
}

/* ============================ Auth flows ============================ */

export async function login({ email, password }) {
  clearSession(); // reset first
  const { login: tries } = endpoints();

  let lastErr = null;
  for (const t of tries) {
    try {
      const resp = await fetch(apiUrl(t.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(t.payload(email, password)),
      });
      const data = await safeJson(resp);
      if (!resp.ok) throw new Error(extractErrorMessage(data) || `Login failed (${resp.status}).`);
      const { access, refresh } = pickTokens(data);
      if (!access || !refresh) throw new Error("Invalid token response.");
      setAccessToken(access);
      setRefreshToken(refresh);
      return data;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Login failed.");
}

export async function registerContractor({ email, password, first_name = "", last_name = "", phone_number = "" }) {
  const ep = endpoints().registerContractor || "/accounts/auth/contractor-register/";
  const resp = await fetch(apiUrl(ep), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, first_name, last_name, phone_number }),
  });
  const data = await safeJson(resp);
  if (!resp.ok) throw new Error(extractErrorMessage(data) || "Registration failed.");
  const { access, refresh } = pickTokens(data);
  if (access) setAccessToken(access);
  if (refresh) setRefreshToken(refresh);
  return data;
}

export function logout(redirectTo = "/") {
  clearSession();
  try { window.location.href = redirectTo; } catch {}
}

/* ======================== Refresh (singleton) ======================== */

let refreshPromise = null;
export async function refreshAccessToken() {
  const refresh = getRefreshToken();
  if (!refresh) throw new Error("No refresh token found.");

  if (refreshPromise) return refreshPromise;

  const { refresh: tries } = endpoints();

  refreshPromise = (async () => {
    let lastErr = null;
    for (const t of tries) {
      try {
        const resp = await fetch(apiUrl(t.url), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh }),
        });
        const data = await safeJson(resp);
        if (!resp.ok) throw new Error(extractErrorMessage(data) || `Refresh failed (${resp.status}).`);
        const { access } = pickTokens(data);
        if (!access) throw new Error("No access token in refresh response.");
        setAccessToken(access);
        return access;
      } catch (e) {
        lastErr = e;
      }
    }
    // all failed → hard logout
    clearSession();
    throw lastErr || new Error("Failed to refresh access token.");
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

/* ===================== fetchWithAuth (Bearer + retry) ===================== */

export async function fetchWithAuth(input, init = {}) {
  const url = input.startsWith("http") ? input : `${BASE_URL}${input}`;
  let access = getAccessToken();

  // proactive refresh if near expiry
  const exp = getAccessExp();
  if (!access || willExpireWithinSeconds(exp, 20)) {
    try { access = await refreshAccessToken(); } catch { access = null; }
  }

  const res1 = await fetch(url, attachAuth(init, access));
  if (res1.status !== 401) return res1;

  // try one refresh on 401
  try {
    const newAccess = await refreshAccessToken();
    return fetch(url, attachAuth(init, newAccess));
  } catch {
    return res1; // let caller handle 401
  }
}

function attachAuth(init, accessToken) {
  const headers = new Headers(init.headers || {});
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  // add JSON content-type if missing and body isn't FormData
  const method = (init.method || "GET").toUpperCase();
  const needsCT = !(method === "GET" || method === "HEAD") && !(init.body instanceof FormData);
  if (needsCT && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return { ...init, headers };
}
