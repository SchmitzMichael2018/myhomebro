// ~/backend/frontend/src/api.js
// v2025-10-22 — endpoint-shim+auth (abs) with /api de-dupe, onboarding remaps,
// GET cachebuster, and global helpers for quick manual auth testing.
//
// Highlights:
// - baseURL = "/api" (server-side API prefix).
// - Request interceptor de-dupes any accidental leading "/api" on config.url.
// - Legacy onboarding remaps → /payments/...
// - Always attach Authorization: Bearer <token> if available.
// - Adds _ts cache-buster to GETs.
// - Exposes window.apiSetAuthToken() / window.apiClearAuth() to set/clear JWT manually.

import axios from "axios";

const TOK = { access: "access", refresh: "refresh", legacyAccess: "accessToken" };
const BASE_URL = "/api"; // server API prefix

// —— In-memory tokens
let MEM_ACCESS = null;
let MEM_REFRESH = null;

// —— Helpers
const isFormData = (v) => typeof FormData !== "undefined" && v instanceof FormData;
const isBlob = (v) => typeof Blob !== "undefined" && v instanceof Blob;
const isURLSearchParams = (v) => typeof URLSearchParams !== "undefined" && v instanceof URLSearchParams;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const SAME_ORIGIN =
  (typeof window !== "undefined" && window.location && window.location.origin) || "";

// Legacy → canonical endpoint remaps (order matters)
const ENDPOINT_REMAP = [
  ["/projects/customers", "/homeowners"],
  ["/customers", "/homeowners"],
  ["/projects/homeowners", "/homeowners"],

  ["/milestones", "/projects/milestones"],
  ["/contractors", "/projects/contractors"],
  ["/attachments", "/projects/attachments"],
  ["/expenses", "/projects/expenses"],

  // Onboarding: legacy → payments (targets do NOT start with "/api" because baseURL is "/api")
  ["/api/projects/contractor-onboarding-status", "/payments/onboarding/status"],
  ["/api/projects/contractor-onboarding",       "/payments/onboarding/start"],
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
      const replaced = path.replace(base, target);
      if (process?.env?.NODE_ENV !== "production") {
        console.log(`[api-shim] ${legacy} → ${target} :: ${path} → ${replaced}`);
      }
      return replaced;
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
      const rebuiltPath = remapRelativePath(u.pathname + u.search + u.hash);
      return u.origin + rebuiltPath;
    }
  } catch {
    /* fall through */
  }
  return remapRelativePath(url);
}

// —— Storage token helpers
export const getAccessToken = () => {
  if (MEM_ACCESS) return MEM_ACCESS;
  try {
    return (
      localStorage.getItem(TOK.access) ||
      sessionStorage.getItem(TOK.access) ||
      localStorage.getItem(TOK.legacyAccess) ||
      sessionStorage.getItem(TOK.legacyAccess) ||
      null
    );
  } catch {
    return null;
  }
};
export const getRefreshToken = () => {
  if (MEM_REFRESH) return MEM_REFRESH;
  try {
    return localStorage.getItem(TOK.refresh) || sessionStorage.getItem(TOK.refresh);
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

// —— Axios instance
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  withCredentials: false,
});

// SINGLE definition
function applyAuthHeader(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    axios.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
    delete axios.defaults.headers.common.Authorization;
  }
}

// —— Public API for login/logout
export function setAuthToken(access, refresh = null, remember = true) {
  MEM_ACCESS = access || null;
  MEM_REFRESH = refresh || null;
  try {
    const store = remember ? localStorage : sessionStorage;
    const other = remember ? sessionStorage : localStorage;

    if (access) {
      store.setItem(TOK.access, access);
      store.setItem(TOK.legacyAccess, access);
    }
    if (refresh) store.setItem(TOK.refresh, refresh);

    other.removeItem(TOK.access);
    other.removeItem(TOK.refresh);
    other.removeItem(TOK.legacyAccess);
  } catch {}
  applyAuthHeader(access);
}
export const setTokens = (a, r, remember = true) => setAuthToken(a, r, remember);

export function clearAuth() {
  MEM_ACCESS = null;
  MEM_REFRESH = null;
  try {
    localStorage.removeItem(TOK.access);
    localStorage.removeItem(TOK.refresh);
    localStorage.removeItem(TOK.legacyAccess);
    sessionStorage.removeItem(TOK.access);
    sessionStorage.removeItem(TOK.refresh);
    sessionStorage.removeItem(TOK.legacyAccess);
  } catch {}
  applyAuthHeader(null);
  try {
    window.dispatchEvent(new CustomEvent("auth:logout", { detail: { reason: "manual-clear" } }));
  } catch {}
}

// Normalize JSON for non-attachment writes
function normalizeForJson(config) {
  const method = (config.method || "get").toLowerCase();
  const wantsBody = /post|put|patch/.test(method);
  if (!wantsBody) return config;

  const url = config.url || "";
  const isAttachment =
    /\/attachments\/?(\?|$|\/)/i.test(url) ||
    /\/milestone-files\/?(\?|$|\/)/i.test(url) ||
    /\/license-upload\/?(\?|$|\/)/i.test(url) ||
    /\/upload\/?(\?|$|\/)/i.test(url);
  if (isAttachment) return config;

  const existingCT =
    (config.headers && (config.headers["Content-Type"] || config.headers["content-type"])) ||
    (api.defaults.headers && api.defaults.headers["Content-Type"]);

  const body = config.data;
  const shouldForceJson =
    !existingCT && !(typeof FormData !== "undefined" && body instanceof FormData) &&
    !(typeof Blob !== "undefined" && body instanceof Blob) &&
    !(typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams);

  if (shouldForceJson) {
    config.headers = {
      ...(config.headers || {}),
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }
  return config;
}

// Optional GET retry
const RETRY = { enableGetRetry: false, max: 2, baseDelayMs: 250 };
const isTransient = (err) => !err?.response || [502, 503, 504].includes(err.response?.status);

// —— Interceptors
function installInterceptors(instance) {
  instance.interceptors.request.use((config) => {
    const token = MEM_ACCESS || getAccessToken();
    if (token) {
      config.headers = { ...(config.headers || {}), Authorization: `Bearer ${token}` };
    } else if (config.headers?.Authorization) {
      delete config.headers.Authorization;
    }

    // 1) remap legacy → canonical
    if (config.url) {
      config.url = remapAny(config.url);
    }

    // 2) de-dupe "/api" when baseURL is "/api" and url mistakenly begins with "/api"
    if (
      instance.defaults.baseURL === "/api" &&
      typeof config.url === "string" &&
      config.url.startsWith("/api/")
    ) {
      config.url = config.url.slice(4); // remove leading "/api"
    } else if (
      instance.defaults.baseURL === "/api" &&
      typeof config.url === "string" &&
      config.url === "/api"
    ) {
      config.url = "/";
    }

    // 3) add a tiny cache-buster for GETs so lists reload cleanly
    if ((config.method || "get").toLowerCase() === "get") {
      const url = new URL(config.url, SAME_ORIGIN || "http://localhost");
      url.searchParams.set("_ts", String(Date.now()));
      config.url = url.pathname + url.search + url.hash;
    }

    return normalizeForJson(config);
  });

  let isRefreshing = false;
  let queue = [];
  const flush = (err, newToken) => {
    queue.forEach(({ resolve, reject }) => (err ? reject(err) : resolve(newToken)));
    queue = [];
  };

  instance.interceptors.response.use(
    (res) => res,
    async (error) => {
      const original = error.config || {};

      if (
        RETRY.enableGetRetry &&
        (original.method || "get").toLowerCase() === "get" &&
        isTransient(error) &&
        (original._retry_count || 0) < RETRY.max
      ) {
        original._retry_count = (original._retry_count || 0) + 1;
        const delay = RETRY.baseDelayMs * 2 ** (original._retry_count - 1);
        await sleep(delay);
        return instance(original);
      }

      if (error.response && error.response.status === 401 && !original._retry) {
        original._retry = true;

        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            queue.push({
              resolve: (token) => {
                if (token) {
                  original.headers = { ...(original.headers || {}), Authorization: `Bearer ${token}` };
                }
                resolve(instance(original));
              },
              reject,
            });
          });
        }

        isRefreshing = true;
        const refresh = MEM_REFRESH || getRefreshToken();
        if (!refresh) {
          isRefreshing = false;
          clearAuth();
          try {
            window.dispatchEvent(new CustomEvent("auth:logout", { detail: { reason: "401" } }));
          } catch {}
          return Promise.reject(error);
        }

        const candidates = ["/auth/refresh/", "/token/refresh/", "/projects/token/refresh/"];

        try {
          let data;
          for (let i = 0; i < candidates.length; i++) {
            try {
              const resp = await instance.post(candidates[i], { refresh });
              data = resp.data;
              break;
            } catch (e) {
              if (i === candidates.length - 1) throw e;
            }
          }

          const newAccess = data?.access || data?.access_token;
          if (typeof newAccess !== "string" || !newAccess) throw new Error("No access token on refresh.");

          setAuthToken(newAccess, refresh, inferRememberFromStorage());

          flush(null, newAccess);
          original.headers = { ...(original.headers || {}), Authorization: `Bearer ${newAccess}` };
          return instance(original);
        } catch (err) {
          flush(err, null);
          clearAuth();
          try {
            window.dispatchEvent(new CustomEvent("auth:logout", { detail: { reason: "refresh-failed" } }));
          } catch {}
          throw err;
        } finally {
          isRefreshing = false;
        }
      }

      // 415 recovery (multipart → JSON) excluding attachments handled above
      if (
        error.response &&
        error.response.status === 415 &&
        /post|put|patch/i.test(original.method || "") &&
        typeof original.url === "string" &&
        !/\/(attachments|milestone-files|license-upload|upload)\/?(\?|$|\/)/i.test(original.url) &&
        (typeof FormData !== "undefined" && original.data instanceof FormData) &&
        !original._retried_as_json
      ) {
        const obj = {};
        original.data.forEach?.((v, k) => {
          if (!(v instanceof Blob)) obj[k] = v;
        });
        const retryConfig = {
          ...original,
          data: obj,
          headers: { ...(original.headers || {}), "Content-Type": "application/json", Accept: "application/json" },
          _retried_as_json: true,
        };
        return instance(retryConfig);
      }

      // 405 fallback for /contractors/me/
      if (
        error.response &&
        error.response.status === 405 &&
        /\/contractors\/me\/?/.test(original.url || "") &&
        /patch|put/i.test(original.method || "")
      ) {
        try {
          const meResp = await instance.get("/projects/contractors/me/");
          const id = meResp?.data?.id ?? meResp?.data?.pk;
          if (!id) throw new Error("Could not resolve contractor id from /contractors/me/");
          const retryConfig = {
            ...original,
            url: (original.url || "").replace(/contractors\/me\/?/, `contractors/${id}/`),
            _retry: true,
          };
          return instance(retryConfig);
        } catch {
          /* ignore */
        }
      }

      return Promise.reject(error);
    }
  );
}

installInterceptors(api);
installInterceptors(axios);

// Seed Authorization at boot (covers hard refresh)
applyAuthHeader(getAccessToken());

// Convenience helper for attachments
export function uploadMultipart(url, formData) {
  return api.post(url, formData);
}

// ---- Global helpers to quickly test auth without changing your UI ----
// DevTools console examples:
//   window.apiSetAuthToken("YOUR_JWT_HERE")
//   window.apiClearAuth()
if (typeof window !== "undefined") {
  window.apiSetAuthToken = (jwt) => setAuthToken(jwt, null, true);
  window.apiClearAuth = () => clearAuth();
}

export default api;
