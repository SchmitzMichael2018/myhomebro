// ~/backend/frontend/src/api.js
// v2025-11-25 — stable-auth shim + canonical /projects/homeowners + onboarding redirect + auto logout redirect + idle timeout
// UPDATED v2026-01-04 — add safe debug logging helpers for 400/422 responses (no behavior changes)
// UPDATED v2026-01-08 — add contractor Business Dashboard summary API
// UPDATED v2026-01-10 — add agreement close & archive helpers
// UPDATED v2026-01-23 — token key hardening (read legacy keys, stop writing them)
// UPDATED v2026-02-18 — FIX refresh recursion + queued request retry (logout reliably on expired tokens)

console.log("api.js v2026-02-18-refresh-queue-fix");

import axios from "axios";

// Canonical keys
const TOK = {
  access: "access",
  refresh: "refresh",
  // legacy reads only (do NOT write these)
  legacyAccessToken: "access_token",
  legacyToken: "token",
  legacyAccessTokenCamel: "accessToken",
};

const BASE_URL = "/api";

let MEM_ACCESS = null;
let MEM_REFRESH = null;

const isFormData = (v) => typeof FormData !== "undefined" && v instanceof FormData;
const isBlob = (v) => typeof Blob !== "undefined" && v instanceof Blob;
const isURLSearchParams = (v) =>
  typeof URLSearchParams !== "undefined" && v instanceof URLSearchParams;

const SAME_ORIGIN = (typeof window !== "undefined" && window.location?.origin) || "";

// No-Auth header endpoints
const NO_AUTH_HEADER_PATHS = new Set([
  "/auth/login/",
  "/auth/refresh/",
  "/auth/register/",
  "/auth/password-reset/request/",
  "/auth/password-reset/confirm/",
  "/auth/password-reset/complete/",
  "/token/",
  "/token/refresh/",
  "/accounts/token/",
  "/accounts/token/refresh/",
  "/auth/jwt/create/",
  "/auth/jwt/refresh/",
]);

// Canonical remaps (unchanged)
const ENDPOINT_REMAP = [
  ["/customers", "/projects/homeowners"],
  ["/homeowners", "/projects/homeowners"],
  ["/milestones", "/projects/milestones"],
  ["/contractors", "/projects/contractors"],
  ["/attachments", "/projects/attachments"],
  ["/expenses", "/projects/expenses"],
  ["/api/projects/contractor-onboarding-status", "/payments/onboarding/status"],
  ["/api/projects/contractor-onboarding", "/payments/onboarding/start"],
  ["/api/projects/contractor-onboarding-manage", "/payments/onboarding/manage"],
];

function normalizePath(url) {
  if (!url || typeof url !== "string") return "/";
  const [path, rest] = url.split(/(?=[?#])/);
  const fixed = ("/" + path).replace(/\/{2,}/g, "/");
  return rest ? fixed + rest : fixed;
}

function remapRelativePath(pathWithQuery) {
  const path = normalizePath(pathWithQuery);
  for (const [legacy, target] of ENDPOINT_REMAP) {
    const base = legacy.endsWith("/") ? legacy.slice(0, -1) : legacy;
    if (
      path === base ||
      path === base + "/" ||
      path.startsWith(base + "/") ||
      path.startsWith(base + "?")
    ) {
      return path.replace(base, target);
    }
  }
  return path;
}

function remapAny(url) {
  if (!url) return url;
  try {
    const u = new URL(url, SAME_ORIGIN || "http://localhost");
    const isAbsolute = /^[a-z]+:\/\//i.test(url);
    const sameOrigin = SAME_ORIGIN && u.origin === SAME_ORIGIN;
    if (isAbsolute && sameOrigin) {
      const rebuilt = remapRelativePath(u.pathname + u.search + u.hash);
      return u.origin + rebuilt;
    }
  } catch {}
  return remapRelativePath(url);
}

function pathOnly(url) {
  try {
    return new URL(url, "https://dummy.local").pathname;
  } catch {
    return (url || "").replace(/[?#].*$/, "");
  }
}

// ------------------------
// Debug helpers
// ------------------------
export function debugAxiosError(err, label = "API") {
  try {
    const status = err?.response?.status;
    const method = err?.config?.method;
    const url = err?.config?.url;
    const data = err?.response?.data;
    console.error(`❌ ${label} error`, { status, method, url, data });
  } catch {
    console.error(`❌ ${label} error`, err);
  }
}

export function extractApiErrorMessage(err) {
  const data = err?.response?.data;
  if (!data) return "Request failed.";
  if (typeof data === "string") return data;
  if (data?.detail) return data.detail;
  if (data?.non_field_errors?.[0]) return data.non_field_errors[0];

  const keys = Object.keys(data || {});
  if (keys.length === 1) {
    const k = keys[0];
    const v = data[k];
    if (Array.isArray(v) && v[0]) return `${k}: ${v[0]}`;
    if (typeof v === "string") return `${k}: ${v}`;
  }
  return "Request failed. Check console for details.";
}

// ------------------------
// Token helpers
// ------------------------
export const getAccessToken = () => {
  if (MEM_ACCESS) return MEM_ACCESS;
  try {
    // Canonical first
    const canon =
      localStorage.getItem(TOK.access) ||
      sessionStorage.getItem(TOK.access) ||
      null;
    if (canon) return canon;

    // Legacy reads (support older code paths)
    return (
      localStorage.getItem(TOK.legacyAccessToken) ||
      sessionStorage.getItem(TOK.legacyAccessToken) ||
      localStorage.getItem(TOK.legacyToken) ||
      sessionStorage.getItem(TOK.legacyToken) ||
      localStorage.getItem(TOK.legacyAccessTokenCamel) ||
      sessionStorage.getItem(TOK.legacyAccessTokenCamel) ||
      null
    );
  } catch {
    return null;
  }
};

export const getRefreshToken = () => {
  if (MEM_REFRESH) return MEM_REFRESH;
  try {
    return (
      localStorage.getItem(TOK.refresh) ||
      sessionStorage.getItem(TOK.refresh) ||
      null
    );
  } catch {
    return null;
  }
};

function inferRememberFromStorage() {
  try {
    if (localStorage.getItem(TOK.refresh)) return true;
    if (sessionStorage.getItem(TOK.refresh)) return false;
  } catch {}
  return true;
}

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  withCredentials: false,
});

function applyAuthHeader(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    axios.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
    delete axios.defaults.headers.common.Authorization;
  }
}

export function setAuthToken(access, refresh = null, remember = true) {
  MEM_ACCESS = access || null;
  MEM_REFRESH = refresh || null;
  try {
    const store = remember ? localStorage : sessionStorage;
    const other = remember ? sessionStorage : localStorage;

    if (access) {
      // ✅ canonical write ONLY
      store.setItem(TOK.access, access);
    }
    if (refresh) store.setItem(TOK.refresh, refresh);

    // Clear out the other store’s canonical keys
    other.removeItem(TOK.access);
    other.removeItem(TOK.refresh);

    // Also scrub legacy keys in both storages to reduce ambiguity
    localStorage.removeItem(TOK.legacyAccessToken);
    localStorage.removeItem(TOK.legacyToken);
    localStorage.removeItem(TOK.legacyAccessTokenCamel);
    sessionStorage.removeItem(TOK.legacyAccessToken);
    sessionStorage.removeItem(TOK.legacyToken);
    sessionStorage.removeItem(TOK.legacyAccessTokenCamel);
  } catch {}
  applyAuthHeader(access);
}

export const setTokens = (a, r, remember = true) => setAuthToken(a, r, remember);

export function clearAuth(redirect = false) {
  MEM_ACCESS = null;
  MEM_REFRESH = null;
  try {
    localStorage.removeItem(TOK.access);
    localStorage.removeItem(TOK.refresh);
    sessionStorage.removeItem(TOK.access);
    sessionStorage.removeItem(TOK.refresh);

    // scrub legacy keys too
    localStorage.removeItem(TOK.legacyAccessToken);
    localStorage.removeItem(TOK.legacyToken);
    localStorage.removeItem(TOK.legacyAccessTokenCamel);
    sessionStorage.removeItem(TOK.legacyAccessToken);
    sessionStorage.removeItem(TOK.legacyToken);
    sessionStorage.removeItem(TOK.legacyAccessTokenCamel);
  } catch {}
  applyAuthHeader(null);

  if (redirect && typeof window !== "undefined") {
    if (window.location.pathname !== "/") {
      window.location.assign("/");
    }
  }
}

function normalizeForJson(config) {
  const method = (config.method || "get").toLowerCase();
  if (!/post|put|patch/.test(method)) return config;

  const url = config.url || "";
  const isAttachment =
    /\/attachments\/|\/milestone-files\/|\/license-upload\/|\/upload\//i.test(url);

  if (isAttachment) return config;

  const body = config.data;
  const existingCT =
    config.headers?.["Content-Type"] ||
    config.headers?.["content-type"] ||
    api.defaults.headers["Content-Type"];

  if (
    !existingCT &&
    !isFormData(body) &&
    !isBlob(body) &&
    !isURLSearchParams(body)
  ) {
    config.headers = {
      ...(config.headers || {}),
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }
  return config;
}

function installInterceptors(instance) {
  instance.interceptors.request.use((config) => {
    if (config.url) config.url = remapAny(config.url);

    if (
      instance.defaults.baseURL === "/api" &&
      typeof config.url === "string" &&
      config.url.startsWith("/api/")
    ) {
      config.url = config.url.slice(4);
    }

    const p = pathOnly(config.url || "");
    if (NO_AUTH_HEADER_PATHS.has(p)) {
      delete config.headers?.Authorization;
    } else {
      const token = MEM_ACCESS || getAccessToken();
      if (token) {
        config.headers = {
          ...(config.headers || {}),
          Authorization: `Bearer ${token}`,
        };
      }
    }
    return normalizeForJson(config);
  });

  let isRefreshing = false;

  // ✅ FIX: queue stores original request configs so we can retry them after refresh
  let queue = [];

  const flush = (err, token) => {
    const q = queue;
    queue = [];

    q.forEach(({ resolve, reject, config }) => {
      if (err) return reject(err);
      try {
        config.headers = { ...(config.headers || {}) };
        if (token) config.headers.Authorization = `Bearer ${token}`;
        resolve(instance(config));
      } catch (e) {
        reject(e);
      }
    });
  };

  instance.interceptors.response.use(
    (res) => res,
    async (error) => {
      const status = error?.response?.status;
      if (status === 400 || status === 422) {
        debugAxiosError(error, "API 400/422");
      }

      if (status !== 401) return Promise.reject(error);

      const config = error.config || {};
      const reqPath = pathOnly(config.url || "");

      // ✅ FIX: if refresh itself 401s, do NOT attempt refresh again
      if (
        reqPath === "/auth/refresh/" ||
        reqPath === "/token/refresh/" ||
        reqPath === "/accounts/token/refresh/" ||
        reqPath === "/auth/jwt/refresh/"
      ) {
        clearAuth(true);
        return Promise.reject(error);
      }

      if (config._retry) return Promise.reject(error);
      config._retry = true;

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          queue.push({ resolve, reject, config });
        });
      }

      isRefreshing = true;
      const refresh = MEM_REFRESH || getRefreshToken();

      if (!refresh) {
        clearAuth(true);
        isRefreshing = false;
        return Promise.reject(error);
      }

      try {
        const resp = await instance.post("/auth/refresh/", { refresh });
        const access = resp.data?.access;
        if (!access) throw new Error("No access token");

        setAuthToken(access, refresh, inferRememberFromStorage());

        // ✅ retry queued requests
        flush(null, access);

        // ✅ retry original request
        config.headers = { ...(config.headers || {}) };
        config.headers.Authorization = `Bearer ${access}`;
        return instance(config);
      } catch (err) {
        flush(err, null);
        clearAuth(true);
        throw err;
      } finally {
        isRefreshing = false;
      }
    }
  );
}

installInterceptors(api);
installInterceptors(axios);
applyAuthHeader(getAccessToken());

// ------------------------
// Business Dashboard API
// ------------------------
export async function getContractorBusinessDashboardSummary(range = "30") {
  const res = await api.get(`/projects/business/contractor/summary/?range=${range}`);
  return res.data;
}

export async function getAgreementDrawRequests(agreementId) {
  const res = await api.get(`/projects/agreements/${agreementId}/draws/`);
  return res.data;
}

export async function createAgreementDrawRequest(agreementId, payload) {
  const res = await api.post(`/projects/agreements/${agreementId}/draws/`, payload);
  return res.data;
}

export async function submitDrawRequest(drawId) {
  const res = await api.post(`/projects/draws/${drawId}/submit/`);
  return res.data;
}

export async function approveDrawRequest(drawId) {
  const res = await api.post(`/projects/draws/${drawId}/approve/`);
  return res.data;
}

export async function rejectDrawRequest(drawId) {
  const res = await api.post(`/projects/draws/${drawId}/reject/`);
  return res.data;
}

export async function requestDrawChanges(drawId) {
  const res = await api.post(`/projects/draws/${drawId}/request_changes/`);
  return res.data;
}

export async function recordDrawExternalPayment(drawId, payload) {
  const headers = payload instanceof FormData ? { "Content-Type": "multipart/form-data" } : undefined;
  const res = await api.post(`/projects/draws/${drawId}/record_external_payment/`, payload, { headers });
  return res.data;
}

export async function getAgreementExternalPayments(agreementId) {
  const res = await api.get(`/projects/agreements/${agreementId}/external-payments/`);
  return res.data;
}

// ------------------------
// ✅ Agreement Close-out / Archive API
// ------------------------
export async function getAgreementClosureStatus(agreementId) {
  if (!agreementId) throw new Error("agreementId is required");
  const res = await api.get(`/projects/agreements/${agreementId}/closure_status/`);
  return res.data;
}

export async function closeAndArchiveAgreement(agreementId) {
  if (!agreementId) throw new Error("agreementId is required");
  const res = await api.post(`/projects/agreements/${agreementId}/close_and_archive/`);
  return res.data;
}

export default api;
